//! Dependency-free Rust compatibility reference for canonical dungeon identity v1.
//! This is not a registry contract. A future near-sdk contract should preserve these bytes.

const GRID: u8 = 9;
const CELL_COUNT: usize = 81;
const DUNGEON_VERSION: u8 = 1;
const SHARE_VERSION: u8 = 1;
const DUNGEON_DOMAIN: &[u8] = b"TRAPRUN:DUNGEON\0";
const CHALLENGE_DOMAIN: &[u8] = b"TRAPRUN:CHALLENGE\0";

#[derive(Clone, Debug)]
struct Dungeon {
    tiles: Vec<u8>,
    start_x: u8,
    start_y: u8,
    exit_x: u8,
    exit_y: u8,
}

#[derive(Clone, Debug)]
struct Registry<'a> {
    chain: &'a str,
    network: &'a str,
    registry: &'a str,
}

fn canonical_dungeon_bytes(dungeon: &Dungeon) -> Result<Vec<u8>, String> {
    if dungeon.tiles.len() != CELL_COUNT {
        return Err(format!("expected {CELL_COUNT} tiles"));
    }
    for (index, tile) in dungeon.tiles.iter().enumerate() {
        if *tile > 9 {
            return Err(format!("unknown tile code {tile} at {index}"));
        }
    }
    for (label, x, y) in [
        ("start", dungeon.start_x, dungeon.start_y),
        ("exit", dungeon.exit_x, dungeon.exit_y),
    ] {
        if x >= GRID || y >= GRID {
            return Err(format!("{label} is outside the grid"));
        }
    }
    if dungeon.start_x == dungeon.exit_x && dungeon.start_y == dungeon.exit_y {
        return Err("start and exit must differ".into());
    }
    let start = usize::from(dungeon.start_y) * usize::from(GRID) + usize::from(dungeon.start_x);
    let exit = usize::from(dungeon.exit_y) * usize::from(GRID) + usize::from(dungeon.exit_x);
    if dungeon.tiles[start] != 0 || dungeon.tiles[exit] != 0 {
        return Err("start and exit tiles must be empty".into());
    }

    let mut out = Vec::with_capacity(11 + CELL_COUNT);
    out.extend_from_slice(b"TRDG");
    out.extend_from_slice(&[
        DUNGEON_VERSION,
        GRID,
        GRID,
        dungeon.start_x,
        dungeon.start_y,
        dungeon.exit_x,
        dungeon.exit_y,
    ]);
    out.extend_from_slice(&dungeon.tiles);
    Ok(out)
}

fn dungeon_hash(dungeon: &Dungeon) -> Result<[u8; 32], String> {
    let mut input = DUNGEON_DOMAIN.to_vec();
    input.extend_from_slice(&canonical_dungeon_bytes(dungeon)?);
    Ok(sha256(&input))
}

fn registry_bytes(context: &Registry<'_>) -> Result<Vec<u8>, String> {
    let chain = identifier(context.chain, "chain", 32)?;
    let network = identifier(context.network, "network", 32)?;
    let registry = identifier(context.registry, "registry", 128)?;
    let mut out = Vec::new();
    out.push(chain.len() as u8);
    out.extend_from_slice(chain);
    out.push(network.len() as u8);
    out.extend_from_slice(network);
    out.extend_from_slice(&(registry.len() as u16).to_be_bytes());
    out.extend_from_slice(registry);
    Ok(out)
}

fn identifier<'a>(value: &'a str, label: &str, max: usize) -> Result<&'a [u8], String> {
    let bytes = value.as_bytes();
    if bytes.is_empty() || bytes.len() > max {
        return Err(format!("invalid {label} length"));
    }
    if !bytes[0].is_ascii_lowercase() && !bytes[0].is_ascii_digit() {
        return Err(format!("invalid {label} first byte"));
    }
    if !bytes.iter().all(|byte| {
        byte.is_ascii_lowercase()
            || byte.is_ascii_digit()
            || matches!(*byte, b'.' | b'_' | b':' | b'-')
    }) {
        return Err(format!("invalid {label} byte"));
    }
    Ok(bytes)
}

fn challenge_hash(
    dungeon: &Dungeon,
    context: &Registry<'_>,
    challenge_id: u64,
) -> Result<[u8; 32], String> {
    if challenge_id == 0 {
        return Err("challenge id must be positive".into());
    }
    let mut canonical = Vec::new();
    canonical.extend_from_slice(b"TRCH");
    canonical.push(SHARE_VERSION);
    canonical.extend_from_slice(&registry_bytes(context)?);
    canonical.extend_from_slice(&challenge_id.to_be_bytes());
    canonical.extend_from_slice(&dungeon_hash(dungeon)?);

    let mut input = CHALLENGE_DOMAIN.to_vec();
    input.extend_from_slice(&canonical);
    Ok(sha256(&input))
}

fn share_code(
    dungeon: &Dungeon,
    context: &Registry<'_>,
    challenge_id: Option<u64>,
) -> Result<String, String> {
    if challenge_id == Some(0) {
        return Err("challenge id must be positive".into());
    }
    let mut payload = Vec::new();
    payload.extend_from_slice(b"TRSC");
    payload.push(SHARE_VERSION);
    payload.push(u8::from(challenge_id.is_some()));
    payload.extend_from_slice(&registry_bytes(context)?);
    payload.extend_from_slice(&canonical_dungeon_bytes(dungeon)?);
    if let Some(id) = challenge_id {
        payload.extend_from_slice(&id.to_be_bytes());
    }
    Ok(format!("TRI1.{}", base64url(&payload)))
}

fn base64url(input: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    for chunk in input.chunks(3) {
        let a = chunk[0];
        let b = *chunk.get(1).unwrap_or(&0);
        let c = *chunk.get(2).unwrap_or(&0);
        out.push(ALPHABET[(a >> 2) as usize] as char);
        out.push(ALPHABET[(((a & 3) << 4) | (b >> 4)) as usize] as char);
        if chunk.len() >= 2 {
            out.push(ALPHABET[(((b & 15) << 2) | (c >> 6)) as usize] as char);
        }
        if chunk.len() == 3 {
            out.push(ALPHABET[(c & 63) as usize] as char);
        }
    }
    out
}

fn hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 15) as usize] as char);
    }
    out
}

fn sha256(input: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut h = [
        0x6a09e667u32,
        0xbb67ae85,
        0x3c6ef372,
        0xa54ff53a,
        0x510e527f,
        0x9b05688c,
        0x1f83d9ab,
        0x5be0cd19,
    ];
    let bit_len = (input.len() as u64) * 8;
    let mut padded = input.to_vec();
    padded.push(0x80);
    while padded.len() % 64 != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in padded.chunks_exact(64) {
        let mut w = [0u32; 64];
        for (i, word) in chunk.chunks_exact(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    let mut out = [0u8; 32];
    for (i, word) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn fixture() -> HashMap<&'static str, &'static str> {
        include_str!("../test-vectors/canonical-dungeon-v1.txt")
            .lines()
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .map(|line| line.split_once('=').expect("fixture line must contain ="))
            .collect()
    }

    #[test]
    fn rust_matches_shared_typescript_fixture_exactly() {
        let fixture = fixture();
        let dungeon = Dungeon {
            tiles: fixture["tile_codes"]
                .bytes()
                .map(|byte| byte.checked_sub(b'0').expect("tile code must be a digit"))
                .collect(),
            start_x: fixture["start_x"].parse().unwrap(),
            start_y: fixture["start_y"].parse().unwrap(),
            exit_x: fixture["exit_x"].parse().unwrap(),
            exit_y: fixture["exit_y"].parse().unwrap(),
        };
        let registry = Registry {
            chain: fixture["chain"],
            network: fixture["network"],
            registry: fixture["registry"],
        };
        let challenge_id: u64 = fixture["challenge_id"].parse().unwrap();

        assert_eq!(
            hex(&canonical_dungeon_bytes(&dungeon).unwrap()),
            fixture["canonical_dungeon_hex"]
        );
        assert_eq!(
            hex(&dungeon_hash(&dungeon).unwrap()),
            fixture["dungeon_hash_hex"]
        );
        assert_eq!(
            share_code(&dungeon, &registry, None).unwrap(),
            fixture["share_dungeon"]
        );
        assert_eq!(
            share_code(&dungeon, &registry, Some(challenge_id)).unwrap(),
            fixture["share_challenge"]
        );
        assert_eq!(
            hex(&challenge_hash(&dungeon, &registry, challenge_id).unwrap()),
            fixture["challenge_hash_hex"]
        );
    }

    #[test]
    fn sha256_reference_is_correct() {
        assert_eq!(
            hex(&sha256(b"abc")),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
