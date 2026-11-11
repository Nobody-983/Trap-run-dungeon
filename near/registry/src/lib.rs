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
struct ChallengeRecord {
    challenge_id: u64,
    dungeon_hash: [u8; DUNGEON_HASH_LENGTH],
    creator: AccountId,
    schema_version: u8,
    registered_at_nanoseconds: u64,
    registered_at_block_height: u64,
    metadata: Option<String>,
}

#[near(serializers = [borsh])]
struct CreatorIndexKey {
    creator: AccountId,
    index: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChallengeView {
    pub challenge_id: U64,
    pub dungeon_hash: Base64VecU8,
    pub creator: AccountId,
    pub schema_version: u8,
    pub registered_at_nanoseconds: U64,
    pub registered_at_block_height: U64,
    pub metadata: Option<String>,
}

impl From<ChallengeRecord> for ChallengeView {
    fn from(record: ChallengeRecord) -> Self {
        Self {
            challenge_id: U64(record.challenge_id),
            dungeon_hash: Base64VecU8(record.dungeon_hash.to_vec()),
            creator: record.creator,
            schema_version: record.schema_version,
            registered_at_nanoseconds: U64(record.registered_at_nanoseconds),
            registered_at_block_height: U64(record.registered_at_block_height),
            metadata: record.metadata,
        }
    }
}

#[near(serializers = [json])]
struct ChallengeRegisteredEventData {
    challenge_id: U64,
    dungeon_hash: Base64VecU8,
    creator: AccountId,
    schema_version: u8,
    metadata: Option<String>,
}

#[near(serializers = [json])]
struct EventEnvelope {
    standard: &'static str,
    version: &'static str,
    event: &'static str,
    data: Vec<ChallengeRegisteredEventData>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TrapRunRegistry {
    /// The next ID that can be allocated. Initialized to one.
    next_challenge_id: u64,
    challenges: LookupMap<u64, ChallengeRecord>,
    creator_counts: LookupMap<AccountId, u64>,
    creator_challenges: LookupMap<CreatorIndexKey, u64>,
    dungeon_challenges: LookupMap<[u8; DUNGEON_HASH_LENGTH], u64>,
}

#[near]
impl TrapRunRegistry {
    #[init]
    pub fn new() -> Self {
        Self {
            next_challenge_id: 1,
            challenges: LookupMap::new(StorageKey::Challenges),
            creator_counts: LookupMap::new(StorageKey::CreatorCounts),
            creator_challenges: LookupMap::new(StorageKey::CreatorChallenges),
            dungeon_challenges: LookupMap::new(StorageKey::DungeonChallenges),
        }
    }

    /// Registers an immutable challenge and returns its globally unique ID.
    ///
    /// The caller must attach enough NEAR to cover the actual persistent storage growth. Any
    /// excess is refunded to the predecessor account after the storage requirement is known.
    #[payable]
    pub fn register_challenge(&mut self, dungeon_hash: Base64VecU8) -> U64 {
        self.register_challenge_with_metadata(dungeon_hash, None)
    }

    /// Registers a challenge with optional creator metadata (e.g. title/CID, max 512 chars).
    /// Enforces duplicate registration protection to establish canonical on-chain authorship.
    #[payable]
    pub fn register_challenge_with_metadata(
        &mut self,
        dungeon_hash: Base64VecU8,
        metadata: Option<String>,
    ) -> U64 {
        let dungeon_hash = parse_dungeon_hash(dungeon_hash);
        assert!(
            self.dungeon_challenges.get(&dungeon_hash).is_none(),
            "Dungeon hash is already registered"
        );

        if let Some(ref meta) = metadata {
            assert!(
                meta.len() <= MAX_METADATA_LENGTH,
                "Metadata exceeds maximum length of {MAX_METADATA_LENGTH} bytes"
            );
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

        let record = ChallengeRecord {
            challenge_id,
            dungeon_hash,
            creator: creator.clone(),
            schema_version: DUNGEON_SCHEMA_VERSION,
            registered_at_nanoseconds: env::block_timestamp(),
            registered_at_block_height: env::block_height(),
            metadata: metadata.clone(),
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
        let attached_deposit = env::attached_deposit().as_yoctonear();

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

    /// Allows the creator of a challenge to update its permitted metadata.
    /// Strictly authorized to predecessor == creator. Handles storage cost adjustment.
    #[payable]
    pub fn update_metadata(&mut self, challenge_id: U64, metadata: Option<String>) {
        let mut record = self
            .challenges
            .get(&challenge_id.0)
            .unwrap_or_else(|| env::panic_str("Challenge not found"));

        let predecessor = env::predecessor_account_id();
        assert_eq!(
            predecessor, record.creator,
            "Unauthorized: only the creator can update metadata"
        );

        if let Some(ref meta) = metadata {
            assert!(
                meta.len() <= MAX_METADATA_LENGTH,
                "Metadata exceeds maximum length of {MAX_METADATA_LENGTH} bytes"
            );
        }

        let storage_before = env::storage_usage();
        record.metadata = metadata;
        self.challenges.insert(&challenge_id.0, &record);
        let storage_after = env::storage_usage();

        let attached_deposit = env::attached_deposit().as_yoctonear();
        if storage_after > storage_before {
            let storage_bytes = storage_after - storage_before;
            let required_deposit = storage_cost(storage_bytes);
            if attached_deposit < required_deposit {
                env::panic_str(
                    format!(
                        "Insufficient storage deposit for metadata update: attached {attached_deposit} yoctoNEAR, required {required_deposit} yoctoNEAR"
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
            // Storage stayed the same or shrank; refund all attached deposit plus any released storage
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
    }

    /// Returns `null` for an unknown challenge ID.
    pub fn get_challenge(&self, challenge_id: U64) -> Option<ChallengeView> {
        self.challenges.get(&challenge_id.0).map(Into::into)
    }

    /// Reverse lookup: retrieves challenge record by its 32-byte canonical dungeon hash.
    pub fn get_challenge_by_hash(&self, dungeon_hash: Base64VecU8) -> Option<ChallengeView> {
        let hash = parse_dungeon_hash(dungeon_hash);
        self.dungeon_challenges
            .get(&hash)
            .and_then(|id| self.challenges.get(&id))
            .map(Into::into)
    }

    /// Checks if a dungeon hash has already been registered.
    pub fn is_dungeon_registered(&self, dungeon_hash: Base64VecU8) -> bool {
        let hash = parse_dungeon_hash(dungeon_hash);
        self.dungeon_challenges.get(&hash).is_some()
    }

    /// Verifies whether the specified account is the verified creator of the challenge.
    pub fn verify_creator(&self, challenge_id: U64, account_id: AccountId) -> bool {
        self.challenges
            .get(&challenge_id.0)
            .map(|c| c.creator == account_id)
            .unwrap_or(false)
    }

    /// Returns total number of challenges registered by `creator`.
    pub fn get_creator_challenge_count(&self, creator: AccountId) -> U64 {
        U64(self.creator_counts.get(&creator).unwrap_or(0))
    }

    /// Returns total count of all registered challenges.
    pub fn get_challenge_count(&self) -> U64 {
        U64(self.next_challenge_id.saturating_sub(1))
    }

    /// Returns a zero-based page of challenges registered by `creator` in registration order.
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

    pub fn get_next_challenge_id(&self) -> U64 {
        U64(self.next_challenge_id)
    }
}

impl TrapRunRegistry {
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

fn storage_cost(storage_bytes: u64) -> u128 {
    env::storage_byte_cost()
        .as_yoctonear()
        .checked_mul(u128::from(storage_bytes))
        .unwrap_or_else(|| env::panic_str("Storage cost overflow"))
}

fn emit_challenge_registered(record: &ChallengeRecord) {
    let event = EventEnvelope {
        standard: EVENT_STANDARD,
        version: EVENT_VERSION,
        event: "challenge_registered",
        data: vec![ChallengeRegisteredEventData {
            challenge_id: U64(record.challenge_id),
            dungeon_hash: Base64VecU8(record.dungeon_hash.to_vec()),
            creator: record.creator.clone(),
            schema_version: record.schema_version,
            metadata: record.metadata.clone(),
        }],
    };
    let json = near_sdk::serde_json::to_string(&event)
        .unwrap_or_else(|_| env::panic_str("Could not serialize registration event"));
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
        contract.register_challenge(dungeon_hash)
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

    #[test]
    fn successful_challenge_registration_records_registration_information() {
        let mut contract = fresh_contract();
        let id = register(&mut contract, accounts(1), hash(7), LARGE_DEPOSIT, 44, 55);
        assert_eq!(id, U64(1));
        assert_eq!(contract.get_next_challenge_id(), U64(2));
        assert_eq!(contract.get_challenge_count(), U64(1));
        let view = contract.get_challenge(id).unwrap();
        assert_eq!(view.dungeon_hash, hash(7));
        assert_eq!(view.schema_version, 1);
        assert_eq!(view.registered_at_block_height, U64(44));
        assert_eq!(view.registered_at_nanoseconds, U64(55));
        assert_eq!(view.metadata, None);
    }

    #[test]
    fn creator_is_always_the_predecessor_account() {
        let mut contract = fresh_contract();
        let id = register(&mut contract, accounts(2), hash(1), LARGE_DEPOSIT, 1, 1);
        assert_eq!(contract.get_challenge(id).unwrap().creator, accounts(2));
        assert!(contract.verify_creator(id, accounts(2)));
        assert!(!contract.verify_creator(id, accounts(1)));
    }

    #[test]
    fn exact_32_byte_hash_is_accepted() {
        let mut contract = fresh_contract();
        let bytes: Vec<u8> = (0..32).collect();
        let id = register(
            &mut contract,
            accounts(1),
            Base64VecU8(bytes.clone()),
            LARGE_DEPOSIT,
            1,
            1,
        );
        assert_eq!(contract.get_challenge(id).unwrap().dungeon_hash.0, bytes);
        assert!(contract.is_dungeon_registered(Base64VecU8(bytes.clone())));
    }

    #[test]
    fn milestone_one_fixture_hash_is_stored_without_transformation() {
        let mut contract = fresh_contract();
        let fixture = fixture_hash();
        let id = register(
            &mut contract,
            accounts(1),
            Base64VecU8(fixture.clone()),
            LARGE_DEPOSIT,
            10,
            20,
        );
        let challenge = contract.get_challenge(id).unwrap();
        assert_eq!(challenge.dungeon_hash.0, fixture);
    }

    #[test]
    fn challenge_ids_are_global_and_sequential() {
        let mut contract = fresh_contract();
        let first = register(&mut contract, accounts(1), hash(1), LARGE_DEPOSIT, 1, 1);
        let second = register(&mut contract, accounts(2), hash(2), LARGE_DEPOSIT, 2, 2);
        let third = register(&mut contract, accounts(1), hash(3), LARGE_DEPOSIT, 3, 3);
        assert_eq!(first, U64(1));
        assert_eq!(second, U64(2));
        assert_eq!(third, U64(3));
        assert_eq!(contract.get_next_challenge_id(), U64(4));
        assert_eq!(contract.get_challenge_count(), U64(3));
    }

    #[test]
    fn creator_pagination_is_zero_based_and_ordered() {
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
        assert_eq!(contract.get_creator_challenge_count(accounts(1)), U64(5));
        let page = contract.get_challenges_by_creator(accounts(1), Some(U64(1)), Some(2));
        assert_eq!(page.len(), 2);
        assert_eq!(page[0].challenge_id, U64(2));
        assert_eq!(page[1].challenge_id, U64(3));
    }

    #[test]
    fn different_creators_receive_distinct_attribution_and_indexes() {
        let mut contract = fresh_contract();
        register(&mut contract, accounts(1), hash(1), LARGE_DEPOSIT, 1, 1);
        register(&mut contract, accounts(2), hash(2), LARGE_DEPOSIT, 2, 2);
        register(&mut contract, accounts(1), hash(3), LARGE_DEPOSIT, 3, 3);

        let creator1_challenges =
            contract.get_challenges_by_creator(accounts(1), Some(U64(0)), Some(10));
        let creator2_challenges =
            contract.get_challenges_by_creator(accounts(2), Some(U64(0)), Some(10));

        assert_eq!(creator1_challenges.len(), 2);
        assert_eq!(creator2_challenges.len(), 1);
        assert_eq!(creator1_challenges[0].challenge_id, U64(1));
        assert_eq!(creator1_challenges[1].challenge_id, U64(3));
        assert_eq!(creator2_challenges[0].challenge_id, U64(2));
    }

    #[test]
    fn pagination_limits_are_bounded() {
        let contract = fresh_contract();
        assert_panics(|| {
            contract.get_challenges_by_creator(accounts(1), Some(U64(0)), Some(0));
        });
        assert_panics(|| {
            contract.get_challenges_by_creator(accounts(1), Some(U64(0)), Some(51));
        });
    }

    #[test]
    fn unknown_challenge_lookup_returns_none() {
        let contract = fresh_contract();
        assert!(contract.get_challenge(U64(1)).is_none());
        assert!(contract.get_challenge(U64(999)).is_none());
        assert!(!contract.verify_creator(U64(999), accounts(1)));
    }

    #[test]
    fn duplicate_dungeon_registration_is_rejected() {
        let mut contract = fresh_contract();
        register(&mut contract, accounts(1), hash(4), LARGE_DEPOSIT, 1, 1);
        // Attempting to register the same dungeon hash must be rejected
        assert_panics(|| {
            register(&mut contract, accounts(2), hash(4), LARGE_DEPOSIT, 2, 2);
        });
    }

    #[test]
    fn reverse_hash_lookup_finds_challenge() {
        let mut contract = fresh_contract();
        let id = register(&mut contract, accounts(1), hash(9), LARGE_DEPOSIT, 1, 1);
        let found = contract.get_challenge_by_hash(hash(9)).unwrap();
        assert_eq!(found.challenge_id, id);
        assert_eq!(found.creator, accounts(1));
        assert!(contract.get_challenge_by_hash(hash(10)).is_none());
    }

    #[test]
    fn metadata_registration_and_update() {
        let mut contract = fresh_contract();
        set_context(accounts(1), LARGE_DEPOSIT, 1, 1);
        let id = contract.register_challenge_with_metadata(
            hash(5),
            Some("Trap Room Alpha".to_string()),
        );

        let challenge = contract.get_challenge(id).unwrap();
        assert_eq!(challenge.metadata, Some("Trap Room Alpha".to_string()));

        // Authorized creator can update metadata
        set_context(accounts(1), LARGE_DEPOSIT, 2, 2);
        contract.update_metadata(id, Some("Trap Room Alpha v2".to_string()));
        let updated = contract.get_challenge(id).unwrap();
        assert_eq!(updated.metadata, Some("Trap Room Alpha v2".to_string()));

        // Unauthorized account cannot update metadata
        set_context(accounts(2), LARGE_DEPOSIT, 3, 3);
        assert_panics(|| {
            contract.update_metadata(id, Some("Hijacked Title".to_string()));
        });
    }

    #[test]
    fn underfunded_registration_reverts_every_write() {
        let mut contract = fresh_contract();
        assert_panics(|| {
            register(
                &mut contract,
                accounts(1),
                hash(1),
                NearToken::from_yoctonear(1),
                1,
                1,
            );
        });

        assert_eq!(contract.get_next_challenge_id(), U64(1));
        assert_eq!(contract.get_challenge_count(), U64(0));
        assert!(contract.get_challenge(U64(1)).is_none());
        assert!(!contract.is_dungeon_registered(hash(1)));
        assert_eq!(contract.get_creator_challenge_count(accounts(1)), U64(0));
    }

    #[test]
    fn malformed_hash_lengths_are_rejected_without_state_changes() {
        let mut contract = fresh_contract();
        assert_panics(|| {
            set_context(accounts(1), LARGE_DEPOSIT, 1, 1);
            contract.register_challenge(Base64VecU8(vec![1; 31]));
        });
        assert_panics(|| {
            set_context(accounts(1), LARGE_DEPOSIT, 1, 1);
            contract.register_challenge(Base64VecU8(vec![1; 33]));
        });
        assert_eq!(contract.get_next_challenge_id(), U64(1));
    }

    #[test]
    fn excess_deposit_is_refunded_to_predecessor() {
        let mut contract = fresh_contract();
        register(&mut contract, accounts(3), hash(1), LARGE_DEPOSIT, 1, 1);
        let refund = transfer_amount().expect("refund promise was not created");
        assert_eq!(refund.0, accounts(3));
        assert!(refund.1.as_yoctonear() > 0);
        assert!(refund.1.as_yoctonear() < LARGE_DEPOSIT.as_yoctonear());
    }

    #[test]
    fn exact_storage_cost_is_retained() {
        let mut contract = fresh_contract();
        let bytes_before = env::storage_usage();
        register(&mut contract, accounts(1), hash(1), LARGE_DEPOSIT, 1, 1);
        let bytes_after = env::storage_usage();
        let retained = LARGE_DEPOSIT.as_yoctonear() - transfer_amount().unwrap().1.as_yoctonear();
        let expected = u128::from(bytes_after - bytes_before) * env::storage_byte_cost().as_yoctonear();
        assert_eq!(retained, expected);
    }

    #[test]
    fn registration_emits_deterministic_nep_297_event() {
        let mut contract = fresh_contract();
        register(&mut contract, accounts(1), hash(9), LARGE_DEPOSIT, 1, 1);
        let logs = get_logs();
        assert_eq!(logs.len(), 1);
        let json_str = logs[0].strip_prefix("EVENT_JSON:").unwrap();
        let value: Value = near_sdk::serde_json::from_str(json_str).unwrap();
        assert_eq!(value["standard"], "trap_run_registry");
        assert_eq!(value["version"], "1.0.0");
        assert_eq!(value["event"], "challenge_registered");
        assert_eq!(value["data"][0]["challenge_id"], "1");
        assert_eq!(value["data"][0]["creator"], accounts(1).to_string());
    }

    #[test]
    fn challenge_counter_overflow_is_rejected_before_mutation() {
        let mut contract = fresh_contract();
        contract.next_challenge_id = u64::MAX;
        assert_panics(|| {
            register(&mut contract, accounts(1), hash(1), LARGE_DEPOSIT, 1, 1);
        });
        assert_eq!(contract.next_challenge_id, u64::MAX);
    }

    #[test]
    fn view_methods_do_not_mutate_state_or_storage() {
        let mut contract = fresh_contract();
        register(&mut contract, accounts(1), hash(1), LARGE_DEPOSIT, 1, 1);
        let storage_before = env::storage_usage();
        let _ = contract.get_challenge(U64(1));
        let _ = contract.get_challenge_by_hash(hash(1));
        let _ = contract.is_dungeon_registered(hash(1));
        let _ = contract.verify_creator(U64(1), accounts(1));
        let _ = contract.get_challenges_by_creator(accounts(1), None, None);
        let _ = contract.get_creator_challenge_count(accounts(1));
        let _ = contract.get_challenge_count();
        let _ = contract.get_next_challenge_id();
        assert_eq!(env::storage_usage(), storage_before);
    }
}
