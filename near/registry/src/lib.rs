use near_sdk::collections::LookupMap;
use near_sdk::json_types::{Base64VecU8, U64};
use near_sdk::{env, near, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise};

const DUNGEON_HASH_LENGTH: usize = 32;
const DUNGEON_SCHEMA_VERSION: u8 = 1;
const DEFAULT_PAGE_LIMIT: u32 = 20;
const MAX_PAGE_LIMIT: u32 = 50;
const EVENT_STANDARD: &str = "trap_run_registry";
const EVENT_VERSION: &str = "1.0.0";

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Challenges,
    CreatorCounts,
    CreatorChallenges,
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
        }
    }
}

#[near(serializers = [json])]
struct ChallengeRegisteredEventData {
    challenge_id: U64,
    dungeon_hash: Base64VecU8,
    creator: AccountId,
    schema_version: u8,
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
        }
    }

    /// Registers an immutable challenge and returns its globally unique ID.
    ///
    /// The caller must attach enough NEAR to cover the actual persistent storage growth. Any
    /// excess is refunded to the predecessor account after the storage requirement is known.
    #[payable]
    pub fn register_challenge(&mut self, dungeon_hash: Base64VecU8) -> U64 {
        let dungeon_hash = parse_dungeon_hash(dungeon_hash);
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

    /// Returns `null` for an unknown challenge ID.
    pub fn get_challenge(&self, challenge_id: U64) -> Option<ChallengeView> {
        self.challenges.get(&challenge_id.0).map(Into::into)
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
        previous_creator_count: Option<u64>,
    ) {
        self.challenges.remove(&challenge_id);
        self.creator_challenges.remove(&creator_index_key);
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
        let view = contract.get_challenge(id).unwrap();
        assert_eq!(view.dungeon_hash, hash(7));
        assert_eq!(view.schema_version, 1);
        assert_eq!(view.registered_at_block_height, U64(44));
        assert_eq!(view.registered_at_nanoseconds, U64(55));
    }

    #[test]
    fn creator_is_always_the_predecessor_account() {
        let mut contract = fresh_contract();
        let id = register(&mut contract, accounts(2), hash(1), LARGE_DEPOSIT, 1, 1);
        assert_eq!(contract.get_challenge(id).unwrap().creator, accounts(2));
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
    }

    #[test]
    fn malformed_hash_lengths_are_rejected_without_state_changes() {
        for length in [0, 31, 33] {
            let mut contract = fresh_contract();
            let storage_before = env::storage_usage();
            assert_panics(|| {
                register(
                    &mut contract,
                    accounts(1),
                    Base64VecU8(vec![0; length]),
                    LARGE_DEPOSIT,
                    1,
                    1,
                );
            });
            assert_eq!(contract.get_next_challenge_id(), U64(1));
            assert_eq!(env::storage_usage(), storage_before);
        }
    }

    #[test]
    fn challenge_ids_are_global_and_sequential() {
        let mut contract = fresh_contract();
        for expected in 1..=4 {
            let id = register(
                &mut contract,
                accounts(1),
                hash(expected as u8),
                LARGE_DEPOSIT,
                expected,
                expected,
            );
            assert_eq!(id, U64(expected));
        }
        assert_eq!(contract.get_next_challenge_id(), U64(5));
    }

    #[test]
    fn same_dungeon_can_be_registered_multiple_times() {
        let mut contract = fresh_contract();
        let first = register(&mut contract, accounts(1), hash(9), LARGE_DEPOSIT, 1, 1);
        let second = register(&mut contract, accounts(1), hash(9), LARGE_DEPOSIT, 2, 2);
        assert_ne!(first, second);
        assert_eq!(contract.get_challenge(first).unwrap().dungeon_hash, hash(9));
        assert_eq!(
            contract.get_challenge(second).unwrap().dungeon_hash,
            hash(9)
        );
    }

    #[test]
    fn different_creators_receive_distinct_attribution_and_indexes() {
        let mut contract = fresh_contract();
        let alice_id = register(&mut contract, accounts(1), hash(1), LARGE_DEPOSIT, 1, 1);
        let bob_id = register(&mut contract, accounts(2), hash(2), LARGE_DEPOSIT, 2, 2);
        assert_eq!(
            contract.get_challenge(alice_id).unwrap().creator,
            accounts(1)
        );
        assert_eq!(contract.get_challenge(bob_id).unwrap().creator, accounts(2));
        assert_eq!(
            contract.get_challenges_by_creator(accounts(1), None, None)[0].challenge_id,
            alice_id
        );
        assert_eq!(
            contract.get_challenges_by_creator(accounts(2), None, None)[0].challenge_id,
            bob_id
        );
    }

    #[test]
    fn unknown_challenge_lookup_returns_none() {
        let contract = fresh_contract();
        assert_eq!(contract.get_challenge(U64(999)), None);
    }

    #[test]
    fn creator_pagination_is_zero_based_and_ordered() {
        let mut contract = fresh_contract();
        for index in 0..5 {
            register(
                &mut contract,
                accounts(1),
                hash(index),
                LARGE_DEPOSIT,
                u64::from(index),
                u64::from(index),
            );
        }
        let page = contract.get_challenges_by_creator(accounts(1), Some(U64(1)), Some(2));
        assert_eq!(
            page.iter()
                .map(|entry| entry.challenge_id.0)
                .collect::<Vec<_>>(),
            vec![2, 3]
        );
        assert!(contract
            .get_challenges_by_creator(accounts(1), Some(U64(99)), Some(2))
            .is_empty());
    }

    #[test]
    fn pagination_limits_are_bounded() {
        let contract = fresh_contract();
        assert_panics(|| {
            contract.get_challenges_by_creator(accounts(1), None, Some(0));
        });
        assert_panics(|| {
            contract.get_challenges_by_creator(accounts(1), None, Some(MAX_PAGE_LIMIT + 1));
        });
    }

    #[test]
    fn underfunded_registration_reverts_every_write() {
        let mut contract = fresh_contract();
        let storage_before = env::storage_usage();
        assert_panics(|| {
            register(
                &mut contract,
                accounts(1),
                hash(4),
                NearToken::from_yoctonear(0),
                1,
                1,
            );
        });
        assert_eq!(contract.get_next_challenge_id(), U64(1));
        assert_eq!(contract.get_challenge(U64(1)), None);
        assert!(contract
            .get_challenges_by_creator(accounts(1), None, None)
            .is_empty());
        assert_eq!(env::storage_usage(), storage_before);
        assert!(get_logs().is_empty());
        assert!(get_created_receipts().is_empty());
    }

    #[test]
    fn exact_storage_cost_is_retained() {
        let mut contract = fresh_contract();
        set_context(accounts(1), LARGE_DEPOSIT, 1, 1);
        let storage_before = env::storage_usage();
        contract.register_challenge(hash(5));
        let storage_after = env::storage_usage();
        let required = storage_cost(storage_after - storage_before);
        let (_, refund) = transfer_amount().expect("excess deposit should be refunded");
        assert_eq!(
            LARGE_DEPOSIT.as_yoctonear() - refund.as_yoctonear(),
            required
        );
    }

    #[test]
    fn excess_deposit_is_refunded_to_predecessor() {
        let mut contract = fresh_contract();
        register(&mut contract, accounts(3), hash(6), LARGE_DEPOSIT, 1, 1);
        let (receiver, refund) = transfer_amount().expect("refund receipt should exist");
        assert_eq!(receiver, accounts(3));
        assert!(refund.as_yoctonear() > 0);
        assert!(refund.as_yoctonear() < LARGE_DEPOSIT.as_yoctonear());
    }

    #[test]
    fn challenge_counter_overflow_is_rejected_before_mutation() {
        let mut contract = fresh_contract();
        contract.next_challenge_id = u64::MAX;
        let storage_before = env::storage_usage();
        assert_panics(|| {
            register(&mut contract, accounts(1), hash(1), LARGE_DEPOSIT, 1, 1);
        });
        assert_eq!(contract.next_challenge_id, u64::MAX);
        assert_eq!(env::storage_usage(), storage_before);
    }

    #[test]
    fn registration_emits_deterministic_nep_297_event() {
        let mut contract = fresh_contract();
        register(&mut contract, accounts(1), hash(8), LARGE_DEPOSIT, 1, 1);
        let logs = get_logs();
        assert_eq!(logs.len(), 1);
        let payload = logs[0]
            .strip_prefix("EVENT_JSON:")
            .expect("NEP-297 events must use EVENT_JSON prefix");
        let value: Value = near_sdk::serde_json::from_str(payload).unwrap();
        assert_eq!(value["standard"], EVENT_STANDARD);
        assert_eq!(value["version"], EVENT_VERSION);
        assert_eq!(value["event"], "challenge_registered");
        assert_eq!(value["data"][0]["challenge_id"], "1");
        assert_eq!(value["data"][0]["creator"], accounts(1).as_str());
        assert_eq!(value["data"][0]["schema_version"], 1);
        assert_eq!(
            value["data"][0]["dungeon_hash"],
            near_sdk::serde_json::to_value(hash(8)).unwrap()
        );
    }

    #[test]
    fn view_methods_do_not_mutate_state_or_storage() {
        let mut contract = fresh_contract();
        register(&mut contract, accounts(1), hash(1), LARGE_DEPOSIT, 1, 1);
        set_context(accounts(2), NearToken::from_yoctonear(0), 2, 2);
        let storage_before = env::storage_usage();
        let next_before = contract.get_next_challenge_id();
        assert!(contract.get_challenge(U64(1)).is_some());
        assert_eq!(
            contract
                .get_challenges_by_creator(accounts(1), None, Some(10))
                .len(),
            1
        );
        assert_eq!(contract.get_next_challenge_id(), next_before);
        assert_eq!(env::storage_usage(), storage_before);
        assert!(get_logs().is_empty());
        assert!(get_created_receipts().is_empty());
    }

    #[test]
    fn milestone_one_fixture_hash_is_stored_without_transformation() {
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
}
