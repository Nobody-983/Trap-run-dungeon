use near_sdk::collections::LookupMap;
use near_sdk::json_types::{Base64VecU8, U64};
use near_sdk::{env, near, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise};

const DUNGEON_HASH_LENGTH: usize = 32;
const DUNGEON_SCHEMA_VERSION: u8 = 1;
const DEFAULT_PAGE_LIMIT: u32 = 20;
const MAX_PAGE_LIMIT: u32 = 50;
const MAX_METADATA_LENGTH: usize = 512;
const EVENT_STANDARD: &str = "trap_run_registry";
const EVENT_VERSION: &str = "1.0.0";
const MIN_PUBLISHING_DEPOSIT_YOCTO: u128 = 50_000_000_000_000_000_000_000; // 0.05 NEAR

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Challenges,
    CreatorCounts,
    CreatorChallenges,
    DungeonChallenges,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
struct DungeonRecord {
    dungeon_id: u64,
    dungeon_hash: [u8; DUNGEON_HASH_LENGTH],
    creator: AccountId,
    schema_version: u8,
    registered_at_nanoseconds: u64,
    registered_at_block_height: u64,
    updated_at_nanoseconds: u64,
    updated_at_block_height: u64,
    version: u32,
    is_published: bool,
    metadata_uri: Option<String>,
}

#[near(serializers = [borsh])]
struct CreatorIndexKey {
    creator: AccountId,
    index: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DungeonView {
    pub dungeon_id: U64,
    pub challenge_id: U64, // Backwards-compatible alias
    pub dungeon_hash: Base64VecU8,
    pub creator: AccountId,
    pub schema_version: u8,
    pub registered_at_nanoseconds: U64,
    pub registered_at_block_height: U64,
    pub updated_at_nanoseconds: U64,
    pub updated_at_block_height: U64,
    pub version: u32,
    pub is_published: bool,
    pub metadata_uri: Option<String>,
    pub metadata: Option<String>, // Backwards-compatible alias
}

pub type ChallengeView = DungeonView;

impl From<DungeonRecord> for DungeonView {
    fn from(record: DungeonRecord) -> Self {
        Self {
            dungeon_id: U64(record.dungeon_id),
            challenge_id: U64(record.dungeon_id),
            dungeon_hash: Base64VecU8(record.dungeon_hash.to_vec()),
            creator: record.creator,
            schema_version: record.schema_version,
            registered_at_nanoseconds: U64(record.registered_at_nanoseconds),
            registered_at_block_height: U64(record.registered_at_block_height),
            updated_at_nanoseconds: U64(record.updated_at_nanoseconds),
            updated_at_block_height: U64(record.updated_at_block_height),
            version: record.version,
            is_published: record.is_published,
            metadata_uri: record.metadata_uri.clone(),
            metadata: record.metadata_uri,
        }
    }
}

// NEP-297 event payload structures
#[near(serializers = [json])]
struct ChallengeRegisteredEventData {
    challenge_id: U64,
    dungeon_hash: Base64VecU8,
    creator: AccountId,
    schema_version: u8,
    metadata: Option<String>,
}

#[near(serializers = [json])]
struct DungeonPublishedEventData {
    dungeon_id: U64,
    dungeon_hash: Base64VecU8,
    creator: AccountId,
    schema_version: u8,
    version: u32,
    metadata_uri: Option<String>,
}

#[near(serializers = [json])]
struct DungeonUpdatedEventData {
    dungeon_id: U64,
    dungeon_hash: Base64VecU8,
    creator: AccountId,
    version: u32,
    metadata_uri: Option<String>,
}

#[near(serializers = [json])]
struct DungeonUnpublishedEventData {
    dungeon_id: U64,
    creator: AccountId,
    version: u32,
}

#[near(serializers = [json])]
struct EventEnvelope<T> {
    standard: &'static str,
    version: &'static str,
    event: &'static str,
    data: Vec<T>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TrapRunRegistry {
    owner_id: AccountId,
    next_challenge_id: u64,
    challenges: LookupMap<u64, DungeonRecord>,
    creator_counts: LookupMap<AccountId, u64>,
    creator_challenges: LookupMap<CreatorIndexKey, u64>,
    dungeon_challenges: LookupMap<[u8; DUNGEON_HASH_LENGTH], u64>,
}

#[near]
impl TrapRunRegistry {
    #[init]
    pub fn new() -> Self {
        Self::init(env::predecessor_account_id())
    }

    #[init]
    pub fn init(owner_id: AccountId) -> Self {
        assert!(!env::state_exists(), "The contract is already initialized");
        Self {
            owner_id,
            next_challenge_id: 1,
            challenges: LookupMap::new(StorageKey::Challenges),
            creator_counts: LookupMap::new(StorageKey::CreatorCounts),
            creator_challenges: LookupMap::new(StorageKey::CreatorChallenges),
            dungeon_challenges: LookupMap::new(StorageKey::DungeonChallenges),
        }
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner_id.clone()
    }

    pub fn set_owner(&mut self, new_owner: AccountId) {
        self.assert_owner();
        self.owner_id = new_owner;
    }

    /// Primary creator-owned publishing method.
    /// Registers a new dungeon with its 32-byte canonical hash and optional metadata URI.
    #[payable]
    pub fn publish_dungeon(
        &mut self,
        dungeon_hash: Base64VecU8,
        metadata_uri: Option<String>,
    ) -> U64 {
        let dungeon_hash = parse_dungeon_hash(dungeon_hash);
        assert!(
            self.dungeon_challenges.get(&dungeon_hash).is_none(),
            "Dungeon hash is already registered"
        );

        let attached_deposit = env::attached_deposit().as_yoctonear();
        assert!(
            attached_deposit >= MIN_PUBLISHING_DEPOSIT_YOCTO,
            "Insufficient deposit: registration requires attaching at least 0.05 NEAR"
        );

        if let Some(ref meta) = metadata_uri {
            assert!(
                meta.len() <= MAX_METADATA_LENGTH,
                "Metadata exceeds maximum length of {MAX_METADATA_LENGTH} bytes"
            );
            validate_metadata_uri(meta);
        }

        let creator = env::predecessor_account_id();
        let challenge_id = self.next_challenge_id;
        let following_challenge_id = challenge_id
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("Challenge ID counter overflow"));
        let previous_creator_count = self.creator_counts.get(&creator);
        let creator_index = previous_creator_count.unwrap_or(0);
        let following_creator_count = creator_index
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("Creator challenge counter overflow"));

        let now_ns = env::block_timestamp();
        let now_height = env::block_height();

        let record = DungeonRecord {
            dungeon_id: challenge_id,
            dungeon_hash,
            creator: creator.clone(),
            schema_version: DUNGEON_SCHEMA_VERSION,
            registered_at_nanoseconds: now_ns,
            registered_at_block_height: now_height,
            updated_at_nanoseconds: now_ns,
            updated_at_block_height: now_height,
            version: 1,
            is_published: true,
            metadata_uri: metadata_uri.clone(),
        };
        let creator_index_key = CreatorIndexKey {
            creator: creator.clone(),
            index: creator_index,
        };

        let storage_before = env::storage_usage();
        self.next_challenge_id = following_challenge_id;
        assert!(
            self.challenges.insert(&challenge_id, &record).is_none(),
            "Challenge ID already exists"
        );
        assert!(
            self.creator_challenges
                .insert(&creator_index_key, &challenge_id)
                .is_none(),
            "Creator challenge index already exists"
        );
        assert!(
            self.dungeon_challenges
                .insert(&dungeon_hash, &challenge_id)
                .is_none(),
            "Dungeon hash index already exists"
        );
        self.creator_counts
            .insert(&creator, &following_creator_count);

        let storage_after = env::storage_usage();
        let storage_bytes = storage_after
            .checked_sub(storage_before)
            .unwrap_or_else(|| env::panic_str("Registration unexpectedly released storage"));
        let required_deposit = storage_cost(storage_bytes);

        if attached_deposit < required_deposit {
            self.rollback_registration(
                challenge_id,
                &creator,
                creator_index_key,
                &dungeon_hash,
                previous_creator_count,
            );
            env::panic_str(
                format!(
                    "Insufficient storage deposit: attached {attached_deposit} yoctoNEAR, required {required_deposit} yoctoNEAR for {storage_bytes} bytes"
                )
                .as_str(),
            );
        }

        emit_challenge_registered(&record);
        emit_dungeon_published(&record);

        let refund = attached_deposit
            .checked_sub(required_deposit)
            .unwrap_or_else(|| env::panic_str("Storage refund underflow"));
        if refund > 0 {
            Promise::new(creator)
                .transfer(NearToken::from_yoctonear(refund))
                .detach();
        }

        U64(challenge_id)
    }

    /// Legacy / frontend-compatible registration alias.
    #[payable]
    pub fn register_challenge(&mut self, dungeon_hash: Base64VecU8) -> U64 {
        self.publish_dungeon(dungeon_hash, None)
    }

    /// Legacy / frontend-compatible registration alias with metadata.
    #[payable]
    pub fn register_challenge_with_metadata(
        &mut self,
        dungeon_hash: Base64VecU8,
        metadata: Option<String>,
    ) -> U64 {
        self.publish_dungeon(dungeon_hash, metadata)
    }

    /// Creator-authorized update to dungeon metadata or content hash.
    /// Strictly authorized to predecessor == creator. Increments version and tracks storage cost.
    #[payable]
    pub fn update_dungeon(
        &mut self,
        dungeon_id: U64,
        new_dungeon_hash: Option<Base64VecU8>,
        metadata_uri: Option<String>,
    ) {
        let mut record = self
            .challenges
            .get(&dungeon_id.0)
            .unwrap_or_else(|| env::panic_str("Dungeon not found"));

        let predecessor = env::predecessor_account_id();
        assert_eq!(
            predecessor, record.creator,
            "Unauthorized: only the creator can update a dungeon"
        );

        if let Some(ref meta) = metadata_uri {
            assert!(
                meta.len() <= MAX_METADATA_LENGTH,
                "Metadata exceeds maximum length of {MAX_METADATA_LENGTH} bytes"
            );
            validate_metadata_uri(meta);
        }

        let storage_before = env::storage_usage();

        if let Some(new_hash_b64) = new_dungeon_hash {
            let new_hash = parse_dungeon_hash(new_hash_b64);
            if new_hash != record.dungeon_hash {
                assert!(
                    self.dungeon_challenges.get(&new_hash).is_none(),
                    "New dungeon hash is already registered to another challenge"
                );
                self.dungeon_challenges.remove(&record.dungeon_hash);
                self.dungeon_challenges.insert(&new_hash, &dungeon_id.0);
                record.dungeon_hash = new_hash;
            }
        }

        record.metadata_uri = metadata_uri;
        record.version = record.version.checked_add(1).unwrap_or(record.version);
        record.updated_at_nanoseconds = env::block_timestamp();
        record.updated_at_block_height = env::block_height();

        self.challenges.insert(&dungeon_id.0, &record);
        let storage_after = env::storage_usage();

        let attached_deposit = env::attached_deposit().as_yoctonear();
        if storage_after > storage_before {
            let storage_bytes = storage_after - storage_before;
            let required_deposit = storage_cost(storage_bytes);
            if attached_deposit < required_deposit {
                env::panic_str(
                    format!(
                        "Insufficient storage deposit for update: attached {attached_deposit} yoctoNEAR, required {required_deposit} yoctoNEAR"
                    )
                    .as_str(),
                );
            }
            let refund = attached_deposit - required_deposit;
            if refund > 0 {
                Promise::new(predecessor)
                    .transfer(NearToken::from_yoctonear(refund))
                    .detach();
            }
        } else {
            let released_bytes = storage_before - storage_after;
            let released_cost = storage_cost(released_bytes);
            let total_refund = attached_deposit
                .checked_add(released_cost)
                .unwrap_or_else(|| env::panic_str("Storage refund overflow"));
            if total_refund > 0 {
                Promise::new(predecessor)
                    .transfer(NearToken::from_yoctonear(total_refund))
                    .detach();
            }
        }

        emit_dungeon_updated(&record);
    }

    /// Legacy update metadata method.
    #[payable]
    pub fn update_metadata(&mut self, challenge_id: U64, metadata: Option<String>) {
        self.update_dungeon(challenge_id, None, metadata);
    }

    /// Creator-authorized unpublish method.
    /// Sets `is_published = false`, increments version, and emits unpublish event.
    pub fn unpublish_dungeon(&mut self, dungeon_id: U64) {
        let mut record = self
            .challenges
            .get(&dungeon_id.0)
            .unwrap_or_else(|| env::panic_str("Dungeon not found"));

        let predecessor = env::predecessor_account_id();
        assert_eq!(
            predecessor, record.creator,
            "Unauthorized: only the creator can unpublish a dungeon"
        );
        assert!(record.is_published, "Dungeon is already unpublished");

        record.is_published = false;
        record.version = record.version.checked_add(1).unwrap_or(record.version);
        record.updated_at_nanoseconds = env::block_timestamp();
        record.updated_at_block_height = env::block_height();

        self.challenges.insert(&dungeon_id.0, &record);
        emit_dungeon_unpublished(&record);
    }

    /// Legacy alias for unpublishing.
    pub fn unpublish_challenge(&mut self, challenge_id: U64) {
        self.unpublish_dungeon(challenge_id);
    }

    // --- View Methods ---

    pub fn get_dungeon(&self, dungeon_id: U64) -> Option<DungeonView> {
        self.challenges.get(&dungeon_id.0).map(Into::into)
    }

    pub fn get_challenge(&self, challenge_id: U64) -> Option<ChallengeView> {
        self.get_dungeon(challenge_id)
    }

    pub fn get_challenge_by_hash(&self, dungeon_hash: Base64VecU8) -> Option<ChallengeView> {
        let hash = parse_dungeon_hash(dungeon_hash);
        self.dungeon_challenges
            .get(&hash)
            .and_then(|id| self.challenges.get(&id))
            .map(Into::into)
    }

    pub fn get_dungeon_by_hash(&self, dungeon_hash: Base64VecU8) -> Option<DungeonView> {
        self.get_challenge_by_hash(dungeon_hash)
    }

    pub fn is_dungeon_registered(&self, dungeon_hash: Base64VecU8) -> bool {
        let hash = parse_dungeon_hash(dungeon_hash);
        self.dungeon_challenges.get(&hash).is_some()
    }

    pub fn verify_creator(&self, challenge_id: U64, account_id: AccountId) -> bool {
        self.challenges
            .get(&challenge_id.0)
            .map(|c| c.creator == account_id)
            .unwrap_or(false)
    }

    pub fn get_creator_challenge_count(&self, creator: AccountId) -> U64 {
        U64(self.creator_counts.get(&creator).unwrap_or(0))
    }

    pub fn get_creator_dungeon_count(&self, creator: AccountId) -> U64 {
        self.get_creator_challenge_count(creator)
    }

    pub fn get_challenge_count(&self) -> U64 {
        U64(self.next_challenge_id.saturating_sub(1))
    }

    pub fn get_dungeon_count(&self) -> U64 {
        self.get_challenge_count()
    }

    pub fn get_challenges_by_creator(
        &self,
        creator: AccountId,
        from_index: Option<U64>,
        limit: Option<u32>,
    ) -> Vec<ChallengeView> {
        let from_index = from_index.unwrap_or(U64(0)).0;
        let limit = limit.unwrap_or(DEFAULT_PAGE_LIMIT);
        assert!(
            (1..=MAX_PAGE_LIMIT).contains(&limit),
            "Pagination limit must be between 1 and {MAX_PAGE_LIMIT}"
        );

        let count = self.creator_counts.get(&creator).unwrap_or(0);
        if from_index >= count {
            return Vec::new();
        }
        let end = from_index.saturating_add(u64::from(limit)).min(count);
        (from_index..end)
            .map(|index| {
                let key = CreatorIndexKey {
                    creator: creator.clone(),
                    index,
                };
                let challenge_id = self.creator_challenges.get(&key).unwrap_or_else(|| {
                    env::panic_str("Registry creator index is internally inconsistent")
                });
                self.challenges
                    .get(&challenge_id)
                    .map(Into::into)
                    .unwrap_or_else(|| {
                        env::panic_str("Registry challenge index is internally inconsistent")
                    })
            })
            .collect()
    }

    pub fn get_creator_dungeons(
        &self,
        creator: AccountId,
        from_index: Option<U64>,
        limit: Option<u32>,
    ) -> Vec<DungeonView> {
        self.get_challenges_by_creator(creator, from_index, limit)
    }

    pub fn get_challenges(
        &self,
        from_index: Option<U64>,
        limit: Option<u32>,
    ) -> Vec<ChallengeView> {
        let from_index = from_index.unwrap_or(U64(0)).0;
        let limit = limit.unwrap_or(DEFAULT_PAGE_LIMIT);
        assert!(
            (1..=MAX_PAGE_LIMIT).contains(&limit),
            "Pagination limit must be between 1 and {MAX_PAGE_LIMIT}"
        );

        let total = self.next_challenge_id.saturating_sub(1);
        if from_index >= total {
            return Vec::new();
        }
        let end = from_index.saturating_add(u64::from(limit)).min(total);
        (from_index..end)
            .filter_map(|idx| {
                let challenge_id = idx.checked_add(1)?;
                self.challenges.get(&challenge_id).map(Into::into)
            })
            .collect()
    }

    pub fn get_dungeons(&self, from_index: Option<U64>, limit: Option<u32>) -> Vec<DungeonView> {
        self.get_challenges(from_index, limit)
    }

    pub fn get_next_challenge_id(&self) -> U64 {
        U64(self.next_challenge_id)
    }

    pub fn get_next_dungeon_id(&self) -> U64 {
        U64(self.next_challenge_id)
    }
}

impl TrapRunRegistry {
    fn assert_owner(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.owner_id,
            "Unauthorized: predecessor is not contract owner"
        );
    }

    fn rollback_registration(
        &mut self,
        challenge_id: u64,
        creator: &AccountId,
        creator_index_key: CreatorIndexKey,
        dungeon_hash: &[u8; DUNGEON_HASH_LENGTH],
        previous_creator_count: Option<u64>,
    ) {
        self.challenges.remove(&challenge_id);
        self.creator_challenges.remove(&creator_index_key);
        self.dungeon_challenges.remove(dungeon_hash);
        match previous_creator_count {
            Some(count) => {
                self.creator_counts.insert(creator, &count);
            }
            None => {
                self.creator_counts.remove(creator);
            }
        }
        self.next_challenge_id = challenge_id;
    }
}

fn parse_dungeon_hash(value: Base64VecU8) -> [u8; DUNGEON_HASH_LENGTH] {
    value.0.try_into().unwrap_or_else(|bytes: Vec<u8>| {
        env::panic_str(
            format!(
                "Dungeon hash must be exactly {DUNGEON_HASH_LENGTH} bytes, received {}",
                bytes.len()
            )
            .as_str(),
        )
    })
}

fn validate_metadata_uri(meta: &str) {
    for b in meta.bytes() {
        assert!(
            b >= 32 && b != 127,
            "Metadata URI must not contain control characters"
        );
    }
}

fn storage_cost(storage_bytes: u64) -> u128 {
    env::storage_byte_cost()
        .as_yoctonear()
        .checked_mul(u128::from(storage_bytes))
        .unwrap_or_else(|| env::panic_str("Storage cost overflow"))
}

fn emit_challenge_registered(record: &DungeonRecord) {
    let event = EventEnvelope {
        standard: EVENT_STANDARD,
        version: EVENT_VERSION,
        event: "challenge_registered",
        data: vec![ChallengeRegisteredEventData {
            challenge_id: U64(record.dungeon_id),
            dungeon_hash: Base64VecU8(record.dungeon_hash.to_vec()),
            creator: record.creator.clone(),
            schema_version: record.schema_version,
            metadata: record.metadata_uri.clone(),
        }],
    };
    let json = near_sdk::serde_json::to_string(&event)
        .unwrap_or_else(|_| env::panic_str("Could not serialize registration event"));
    env::log_str(format!("EVENT_JSON:{json}").as_str());
}

fn emit_dungeon_published(record: &DungeonRecord) {
    let event = EventEnvelope {
        standard: EVENT_STANDARD,
        version: EVENT_VERSION,
        event: "dungeon_published",
        data: vec![DungeonPublishedEventData {
            dungeon_id: U64(record.dungeon_id),
            dungeon_hash: Base64VecU8(record.dungeon_hash.to_vec()),
            creator: record.creator.clone(),
            schema_version: record.schema_version,
            version: record.version,
            metadata_uri: record.metadata_uri.clone(),
        }],
    };
    let json = near_sdk::serde_json::to_string(&event)
        .unwrap_or_else(|_| env::panic_str("Could not serialize dungeon published event"));
    env::log_str(format!("EVENT_JSON:{json}").as_str());
}

fn emit_dungeon_updated(record: &DungeonRecord) {
    let event = EventEnvelope {
        standard: EVENT_STANDARD,
        version: EVENT_VERSION,
        event: "dungeon_updated",
        data: vec![DungeonUpdatedEventData {
            dungeon_id: U64(record.dungeon_id),
            dungeon_hash: Base64VecU8(record.dungeon_hash.to_vec()),
            creator: record.creator.clone(),
            version: record.version,
            metadata_uri: record.metadata_uri.clone(),
        }],
    };
    let json = near_sdk::serde_json::to_string(&event)
        .unwrap_or_else(|_| env::panic_str("Could not serialize dungeon updated event"));
    env::log_str(format!("EVENT_JSON:{json}").as_str());
}

fn emit_dungeon_unpublished(record: &DungeonRecord) {
    let event = EventEnvelope {
        standard: EVENT_STANDARD,
        version: EVENT_VERSION,
        event: "dungeon_unpublished",
        data: vec![DungeonUnpublishedEventData {
            dungeon_id: U64(record.dungeon_id),
            creator: record.creator.clone(),
            version: record.version,
        }],
    };
    let json = near_sdk::serde_json::to_string(&event)
        .unwrap_or_else(|_| env::panic_str("Could not serialize dungeon unpublished event"));
    env::log_str(format!("EVENT_JSON:{json}").as_str());
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::mock::MockAction;
    use near_sdk::serde_json::Value;
    use near_sdk::test_utils::{accounts, get_created_receipts, get_logs, VMContextBuilder};
    use near_sdk::{test_vm_config, RuntimeFeesConfig};
    use std::collections::HashMap;
    use std::panic::{catch_unwind, AssertUnwindSafe};

    const LARGE_DEPOSIT: NearToken = NearToken::from_near(1);

    fn context(
        predecessor: AccountId,
        deposit: NearToken,
        height: u64,
        timestamp: u64,
    ) -> near_sdk::VMContext {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id("registry.testnet".parse().unwrap())
            .signer_account_id(predecessor.clone())
            .predecessor_account_id(predecessor)
            .attached_deposit(deposit)
            .block_height(height)
            .block_timestamp(timestamp);
        builder.build()
    }

    fn fresh_contract() -> TrapRunRegistry {
        let blockchain = near_sdk::MockedBlockchain::new(
            context(accounts(0), NearToken::from_yoctonear(0), 1, 1),
            test_vm_config(),
            RuntimeFeesConfig::test(),
            Vec::new(),
            HashMap::new(),
            HashMap::new(),
            None,
        );
        env::set_blockchain_interface(blockchain);
        TrapRunRegistry::new()
    }

    fn set_context(predecessor: AccountId, deposit: NearToken, height: u64, timestamp: u64) {
        near_sdk::testing_env!(context(predecessor, deposit, height, timestamp));
    }

    fn hash(byte: u8) -> Base64VecU8 {
        Base64VecU8(vec![byte; DUNGEON_HASH_LENGTH])
    }

    fn fixture_hash() -> Vec<u8> {
        let fixture = include_str!("../../../test-vectors/canonical-dungeon-v1.txt");
        let hex = fixture
            .lines()
            .find_map(|line| line.strip_prefix("dungeon_hash_hex="))
            .expect("fixture must contain dungeon_hash_hex");
        (0..hex.len())
            .step_by(2)
            .map(|index| u8::from_str_radix(&hex[index..index + 2], 16).unwrap())
            .collect()
    }

    fn register(
        contract: &mut TrapRunRegistry,
        creator: AccountId,
        dungeon_hash: Base64VecU8,
        deposit: NearToken,
        height: u64,
        timestamp: u64,
    ) -> U64 {
        set_context(creator, deposit, height, timestamp);
        contract.publish_dungeon(dungeon_hash, None)
    }

    fn assert_panics(f: impl FnOnce()) {
        assert!(catch_unwind(AssertUnwindSafe(f)).is_err());
    }

    fn transfer_amount() -> Option<(AccountId, NearToken)> {
        get_created_receipts().into_iter().find_map(|receipt| {
            receipt.actions.into_iter().find_map(|action| match action {
                MockAction::Transfer { deposit, .. } => {
                    Some((receipt.receiver_id.clone(), deposit))
                }
                _ => None,
            })
        })
    }

    // 1. Contract initialization test
    #[test]
    fn test_contract_initialization() {
        let contract = fresh_contract();
        assert_eq!(contract.get_owner(), accounts(0));
        assert_eq!(contract.get_dungeon_count(), U64(0));
        assert_eq!(contract.get_next_dungeon_id(), U64(1));

        near_sdk::env::state_write(&contract);

        // Re-initialization must panic
        assert_panics(|| {
            TrapRunRegistry::init(accounts(1));
        });
    }

    #[test]
    fn test_milestone_one_fixture_hash_preserved() {
        let mut contract = fresh_contract();
        let expected = fixture_hash();
        let id = register(
            &mut contract,
            accounts(1),
            Base64VecU8(expected.clone()),
            LARGE_DEPOSIT,
            1,
            1,
        );
        assert_eq!(contract.get_challenge(id).unwrap().dungeon_hash.0, expected);
    }

    // 2. Successful creator publishing
    #[test]
    fn test_successful_creator_publishing() {
        let mut contract = fresh_contract();
        let id = register(&mut contract, accounts(1), hash(7), LARGE_DEPOSIT, 44, 55);
        assert_eq!(id, U64(1));
        assert_eq!(contract.get_next_dungeon_id(), U64(2));
        assert_eq!(contract.get_dungeon_count(), U64(1));
        let view = contract.get_dungeon(id).unwrap();
        assert_eq!(view.dungeon_hash, hash(7));
        assert_eq!(view.schema_version, 1);
        assert_eq!(view.registered_at_block_height, U64(44));
        assert_eq!(view.registered_at_nanoseconds, U64(55));
        assert_eq!(view.version, 1);
        assert!(view.is_published);
        assert_eq!(view.metadata_uri, None);
    }

    // 3. Duplicate dungeon ID / hash rejection
    #[test]
    fn test_duplicate_dungeon_registration_rejected() {
        let mut contract = fresh_contract();
        register(&mut contract, accounts(1), hash(1), LARGE_DEPOSIT, 1, 1);
        assert_panics(|| {
            register(&mut contract, accounts(2), hash(1), LARGE_DEPOSIT, 2, 2);
        });
    }

    // 4. Different creators receive distinct attribution and indexes
    #[test]
    fn test_different_creators_receive_distinct_attribution_and_indexes() {
        let mut contract = fresh_contract();
        let a = register(&mut contract, accounts(1), hash(1), LARGE_DEPOSIT, 1, 1);
        let b = register(&mut contract, accounts(2), hash(2), LARGE_DEPOSIT, 2, 2);
        assert_eq!(contract.get_creator_dungeon_count(accounts(1)), U64(1));
        assert_eq!(contract.get_creator_dungeon_count(accounts(2)), U64(1));
        assert_eq!(contract.get_dungeon(a).unwrap().creator, accounts(1));
        assert_eq!(contract.get_dungeon(b).unwrap().creator, accounts(2));
    }

    // 5. Creator retrieving their own dungeon
    #[test]
    fn test_creator_retrieving_own_dungeon() {
        let mut contract = fresh_contract();
        let id = register(&mut contract, accounts(1), hash(5), LARGE_DEPOSIT, 10, 20);
        let dungeons = contract.get_creator_dungeons(accounts(1), None, None);
        assert_eq!(dungeons.len(), 1);
        assert_eq!(dungeons[0].dungeon_id, id);
        assert_eq!(dungeons[0].creator, accounts(1));
    }

    // 6. Public dungeon retrieval
    #[test]
    fn test_public_dungeon_retrieval() {
        let mut contract = fresh_contract();
        let id = register(&mut contract, accounts(1), hash(9), LARGE_DEPOSIT, 1, 1);

        set_context(accounts(3), NearToken::from_yoctonear(0), 2, 2);
        let view = contract.get_dungeon(id).unwrap();
        assert_eq!(view.dungeon_id, id);

        let by_hash = contract.get_dungeon_by_hash(hash(9)).unwrap();
        assert_eq!(by_hash.dungeon_id, id);
    }

    // 7. Unauthorized update rejection
    #[test]
    fn test_unauthorized_update_rejection() {
        let mut contract = fresh_contract();
        let id = register(&mut contract, accounts(1), hash(1), LARGE_DEPOSIT, 1, 1);

        set_context(accounts(2), LARGE_DEPOSIT, 2, 2);
        assert_panics(|| {
            contract.update_dungeon(id, None, Some("ipfs://new-cid".to_string()));
        });
    }

    // 8. Unauthorized unpublish rejection
    #[test]
    fn test_unauthorized_unpublish_rejection() {
        let mut contract = fresh_contract();
        let id = register(&mut contract, accounts(1), hash(1), LARGE_DEPOSIT, 1, 1);

        set_context(accounts(2), NearToken::from_yoctonear(0), 2, 2);
        assert_panics(|| {
            contract.unpublish_dungeon(id);
        });
    }

    // 9. Creator update success
    #[test]
    fn test_creator_update_success() {
        let mut contract = fresh_contract();
        let id = register(&mut contract, accounts(1), hash(1), LARGE_DEPOSIT, 1, 100);

        set_context(accounts(1), LARGE_DEPOSIT, 2, 200);
        contract.update_dungeon(
            id,
            Some(hash(2)),
            Some("ipfs://bafybeicdungeonmeta".to_string()),
        );

        let view = contract.get_dungeon(id).unwrap();
        assert_eq!(view.version, 2);
        assert_eq!(view.dungeon_hash, hash(2));
        assert_eq!(
            view.metadata_uri,
            Some("ipfs://bafybeicdungeonmeta".to_string())
        );
        assert_eq!(view.updated_at_nanoseconds, U64(200));
        assert_eq!(view.updated_at_block_height, U64(2));
    }

    // 10. Version increment
    #[test]
    fn test_version_increment() {
        let mut contract = fresh_contract();
        let id = register(&mut contract, accounts(1), hash(1), LARGE_DEPOSIT, 1, 1);
        assert_eq!(contract.get_dungeon(id).unwrap().version, 1);

        set_context(accounts(1), LARGE_DEPOSIT, 2, 2);
        contract.update_dungeon(id, None, Some("v2".to_string()));
        assert_eq!(contract.get_dungeon(id).unwrap().version, 2);

        set_context(accounts(1), NearToken::from_yoctonear(0), 3, 3);
        contract.unpublish_dungeon(id);
        assert_eq!(contract.get_dungeon(id).unwrap().version, 3);
    }

    // 11. Unpublish behavior
    #[test]
    fn test_unpublish_behavior() {
        let mut contract = fresh_contract();
        let id = register(&mut contract, accounts(1), hash(1), LARGE_DEPOSIT, 1, 1);
        assert!(contract.get_dungeon(id).unwrap().is_published);

        set_context(accounts(1), NearToken::from_yoctonear(0), 2, 2);
        contract.unpublish_dungeon(id);

        let view = contract.get_dungeon(id).unwrap();
        assert!(!view.is_published);

        // Cannot unpublish twice
        assert_panics(|| {
            contract.unpublish_dungeon(id);
        });
    }

    // 12. Invalid metadata URI validation
    #[test]
    fn test_invalid_metadata_uri() {
        let mut contract = fresh_contract();
        // Metadata containing control characters must panic
        assert_panics(|| {
            set_context(accounts(1), LARGE_DEPOSIT, 1, 1);
            contract.publish_dungeon(hash(1), Some("invalid\ncontrol\tchars".to_string()));
        });
    }

    // 13. Invalid content hash length
    #[test]
    fn test_invalid_content_hash() {
        let mut contract = fresh_contract();
        assert_panics(|| {
            set_context(accounts(1), LARGE_DEPOSIT, 1, 1);
            contract.publish_dungeon(Base64VecU8(vec![1, 2, 3]), None);
        });
    }

    // 14. Input-size limits (max 512 bytes metadata)
    #[test]
    fn test_input_size_limits() {
        let mut contract = fresh_contract();
        let excessive_meta = "x".repeat(513);
        assert_panics(|| {
            set_context(accounts(1), LARGE_DEPOSIT, 1, 1);
            contract.publish_dungeon(hash(1), Some(excessive_meta));
        });
    }

    // 15. Pagination limits
    #[test]
    fn test_pagination_limits() {
        let mut contract = fresh_contract();
        for i in 1..=5 {
            register(
                &mut contract,
                accounts(1),
                hash(i as u8),
                LARGE_DEPOSIT,
                i,
                i,
            );
        }
        assert_panics(|| {
            contract.get_creator_dungeons(accounts(1), None, Some(0));
        });
        assert_panics(|| {
            contract.get_creator_dungeons(accounts(1), None, Some(51));
        });

        let page = contract.get_creator_dungeons(accounts(1), Some(U64(1)), Some(2));
        assert_eq!(page.len(), 2);
        assert_eq!(page[0].dungeon_id, U64(2));
        assert_eq!(page[1].dungeon_id, U64(3));
    }

    // 16. Insufficient storage deposit rejection
    #[test]
    fn test_insufficient_storage_deposit() {
        let mut contract = fresh_contract();
        assert_panics(|| {
            // Less than 0.05 NEAR
            register(
                &mut contract,
                accounts(1),
                hash(1),
                NearToken::from_near(0),
                1,
                1,
            );
        });
    }

    // 17. Storage accounting & excess refund
    #[test]
    fn test_storage_accounting_and_refund() {
        let mut contract = fresh_contract();
        let deposit = NearToken::from_near(2);
        let id = register(&mut contract, accounts(1), hash(1), deposit, 1, 1);
        assert_eq!(id, U64(1));
        let (recipient, refund) = transfer_amount().expect("Expected excess deposit refund");
        assert_eq!(recipient, accounts(1));
        assert!(refund > NearToken::from_near(1));
    }

    // 18. Event emission format
    #[test]
    fn test_event_emission_format() {
        let mut contract = fresh_contract();
        register(&mut contract, accounts(1), hash(1), LARGE_DEPOSIT, 1, 1);
        let logs = get_logs();
        assert!(logs.iter().any(|log| log.starts_with("EVENT_JSON:")));
    }

    // 19. NEP-297 event JSON parsing
    #[test]
    fn test_nep297_event_json_parsing() {
        let mut contract = fresh_contract();
        register(&mut contract, accounts(1), hash(1), LARGE_DEPOSIT, 1, 1);
        let logs = get_logs();
        let pub_log = logs
            .iter()
            .find(|l| l.contains("\"event\":\"dungeon_published\""))
            .expect("dungeon_published event not found in logs");

        let json_str = pub_log.strip_prefix("EVENT_JSON:").unwrap();
        let parsed: Value = near_sdk::serde_json::from_str(json_str).unwrap();
        assert_eq!(parsed["standard"], "trap_run_registry");
        assert_eq!(parsed["version"], "1.0.0");
        assert_eq!(parsed["event"], "dungeon_published");
        assert_eq!(parsed["data"][0]["dungeon_id"], "1");
        assert_eq!(parsed["data"][0]["creator"], accounts(1).to_string());
        assert_eq!(parsed["data"][0]["version"], 1);
    }

    // 20. Existing frontend and Edge Function compatibility
    #[test]
    fn test_existing_frontend_and_edge_function_compatibility() {
        let mut contract = fresh_contract();
        set_context(accounts(1), LARGE_DEPOSIT, 10, 20);
        let id = contract.register_challenge_with_metadata(hash(3), Some("My Dungeon".to_string()));
        assert_eq!(id, U64(1));

        let view = contract.get_challenge(id).unwrap();
        assert_eq!(view.challenge_id, id);
        assert_eq!(view.dungeon_id, id);
        assert_eq!(view.metadata, Some("My Dungeon".to_string()));
        assert_eq!(view.metadata_uri, Some("My Dungeon".to_string()));
        assert_eq!(view.creator, accounts(1));

        // Event logs must contain legacy event "challenge_registered"
        let logs = get_logs();
        let reg_log = logs
            .iter()
            .find(|l| l.contains("\"event\":\"challenge_registered\""))
            .expect("challenge_registered event not found");
        let parsed: Value =
            near_sdk::serde_json::from_str(reg_log.strip_prefix("EVENT_JSON:").unwrap()).unwrap();
        assert_eq!(parsed["standard"], "trap_run_registry");
        assert_eq!(parsed["data"][0]["challenge_id"], "1");
    }
}
