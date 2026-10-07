// SPDX-License-Identifier: Apache-2.0
//! Database round trips and, above all, refusal on decode: a stored value that
//! is not a valid identifier surfaces as a decode error instead of a default.
//!
//! PostgreSQL: a disposable test database on localhost:54399, database, user
//! and password as in `PG_URL` (CI runs it as a service container). SQLite:
//! in-memory.

use sid_ids::{DeviceId, MachineUserId, ProfileId, SessionId};
use sqlx::Row;

const V7: &str = "0192f3a4-7c1e-7b2a-9d4e-3f5a6b7c8d9e";
const V4: &str = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const NIL: &str = "00000000-0000-0000-0000-000000000000";

const PG_URL: &str = "postgres://sid:sid_dev@localhost:54399/sid";

async fn pg() -> sqlx::PgPool {
    sqlx::PgPool::connect(PG_URL)
        .await
        .expect("test PostgreSQL on 54399 must be running")
}

async fn sqlite() -> sqlx::SqlitePool {
    sqlx::SqlitePool::connect("sqlite::memory:")
        .await
        .expect("in-memory SQLite")
}

// --- PostgreSQL ------------------------------------------------------------

#[tokio::test]
async fn pg_encode_and_decode_keep_the_value() {
    // Bug prevented: an id changing bytes across a native uuid column.
    let pool = pg().await;
    let id = ProfileId::parse(V7).unwrap();
    let row = sqlx::query("SELECT $1::uuid AS id")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let back: ProfileId = row.get("id");
    assert_eq!(back, id);
}

#[tokio::test]
async fn pg_decode_refuses_nil_and_wrong_version() {
    // Bug prevented: corrupted or legacy rows decoded into a "valid" id.
    let pool = pg().await;
    for (text, expect) in [(NIL, "the nil UUID"), (V4, "expected version 7")] {
        let row = sqlx::query("SELECT $1::uuid AS id")
            .bind(uuid::Uuid::parse_str(text).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
        let err = row.try_get::<SessionId, _>("id").unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("invalid SessionId"), "{msg}");
        assert!(msg.contains(expect), "{msg}");
    }
}

#[tokio::test]
async fn pg_decode_refuses_a_column_of_another_type() {
    // Bug prevented: a text or integer column silently read as an id.
    let pool = pg().await;
    let row = sqlx::query("SELECT 'not-a-uuid'::text AS id")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(row.try_get::<DeviceId, _>("id").is_err());
}

#[tokio::test]
async fn pg_array_of_ids_round_trips() {
    let pool = pg().await;
    let ids = vec![MachineUserId::generate(), MachineUserId::generate()];
    let row = sqlx::query("SELECT $1::uuid[] AS ids")
        .bind(&ids)
        .fetch_one(&pool)
        .await
        .unwrap();
    let back: Vec<MachineUserId> = row.get("ids");
    assert_eq!(back, ids);
}

// --- SQLite ----------------------------------------------------------------

#[tokio::test]
async fn sqlite_encodes_as_hyphenated_text_and_decodes_it_back() {
    // Bug prevented: a change of the TEXT form existing SQLite rows use.
    let pool = sqlite().await;
    let id = ProfileId::parse(V7).unwrap();
    let row = sqlx::query("SELECT ?1 AS id, typeof(?1) AS ty")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let ty: String = row.get("ty");
    assert_eq!(ty, "text");
    let raw: String = row.get("id");
    assert_eq!(raw, V7);
    let back: ProfileId = row.get("id");
    assert_eq!(back, id);
}

#[tokio::test]
async fn sqlite_decode_refuses_nil_wrong_version_and_garbage() {
    // Bug prevented: `Uuid::parse_str(..).unwrap_or_default()` on read, which
    // turned a corrupted row into the nil id.
    let pool = sqlite().await;
    for (text, expect) in [
        (NIL, "the nil UUID"),
        (V4, "expected version 7"),
        ("garbage", "not a UUID"),
    ] {
        let row = sqlx::query("SELECT ?1 AS id")
            .bind(text)
            .fetch_one(&pool)
            .await
            .unwrap();
        let err = row.try_get::<DeviceId, _>("id").unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("invalid DeviceId"), "{msg}");
        assert!(msg.contains(expect), "{msg}");
    }
}

#[tokio::test]
async fn sqlite_decode_refuses_null() {
    let pool = sqlite().await;
    let row = sqlx::query("SELECT NULL AS id")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(row.try_get::<SessionId, _>("id").is_err());
    let none: Option<SessionId> = row.get("id");
    assert!(none.is_none());
}
