// SPDX-License-Identifier: Apache-2.0
//! Database encoding and decoding. Decoding validates: a stored value without
//! the expected kind's shape is a decode error, never a default.
//!
//! PostgreSQL stores identifiers as native `uuid`. SQLite stores them as the
//! hyphenated text the schema already uses.

use sqlx::error::BoxDynError;

use crate::{
    AccessRequestId, ApplicationId, BindingId, CedarPolicyId, CredentialId, DeviceId, GroupId,
    IssuerId, MachineUserId, MagicLinkId, OrgId, OtpSessionId, PasswordOperationId, PrincipalId,
    ProfileEmailId, ProfileId, ProfilePhoneId, ProjectId, ProvisioningConnectorId,
    ProvisioningCredentialId, ResetSessionId, ResourceId, RoleAssignmentId, RoleId, SessionId,
};

macro_rules! sqlx_id {
    ($name:ident) => {
        #[cfg(feature = "sqlx-postgres")]
        impl sqlx::Type<sqlx::Postgres> for $name {
            fn type_info() -> sqlx::postgres::PgTypeInfo {
                <uuid::Uuid as sqlx::Type<sqlx::Postgres>>::type_info()
            }

            fn compatible(ty: &sqlx::postgres::PgTypeInfo) -> bool {
                <uuid::Uuid as sqlx::Type<sqlx::Postgres>>::compatible(ty)
            }
        }

        #[cfg(feature = "sqlx-postgres")]
        impl sqlx::postgres::PgHasArrayType for $name {
            fn array_type_info() -> sqlx::postgres::PgTypeInfo {
                <uuid::Uuid as sqlx::postgres::PgHasArrayType>::array_type_info()
            }
        }

        #[cfg(feature = "sqlx-postgres")]
        impl<'r> sqlx::Decode<'r, sqlx::Postgres> for $name {
            fn decode(value: sqlx::postgres::PgValueRef<'r>) -> Result<Self, BoxDynError> {
                let uuid = <uuid::Uuid as sqlx::Decode<'r, sqlx::Postgres>>::decode(value)?;
                Ok(Self::from_uuid(uuid)?)
            }
        }

        #[cfg(feature = "sqlx-postgres")]
        impl<'q> sqlx::Encode<'q, sqlx::Postgres> for $name {
            fn encode_by_ref(
                &self,
                buf: &mut sqlx::postgres::PgArgumentBuffer,
            ) -> Result<sqlx::encode::IsNull, BoxDynError> {
                <uuid::Uuid as sqlx::Encode<'q, sqlx::Postgres>>::encode_by_ref(self.as_uuid(), buf)
            }
        }

        #[cfg(feature = "sqlx-sqlite")]
        impl sqlx::Type<sqlx::Sqlite> for $name {
            fn type_info() -> sqlx::sqlite::SqliteTypeInfo {
                <str as sqlx::Type<sqlx::Sqlite>>::type_info()
            }

            fn compatible(ty: &sqlx::sqlite::SqliteTypeInfo) -> bool {
                <str as sqlx::Type<sqlx::Sqlite>>::compatible(ty)
            }
        }

        #[cfg(feature = "sqlx-sqlite")]
        impl<'r> sqlx::Decode<'r, sqlx::Sqlite> for $name {
            fn decode(value: sqlx::sqlite::SqliteValueRef<'r>) -> Result<Self, BoxDynError> {
                let text = <&str as sqlx::Decode<'r, sqlx::Sqlite>>::decode(value)?;
                Ok(Self::parse(text)?)
            }
        }

        // The argument buffer admits no outside writes, so the text form is
        // handed to the `String` encoder rather than pushed directly.
        #[cfg(feature = "sqlx-sqlite")]
        impl<'q> sqlx::Encode<'q, sqlx::Sqlite> for $name {
            fn encode_by_ref(
                &self,
                args: &mut <sqlx::Sqlite as sqlx::Database>::ArgumentBuffer,
            ) -> Result<sqlx::encode::IsNull, BoxDynError> {
                <String as sqlx::Encode<'q, sqlx::Sqlite>>::encode(self.to_string(), args)
            }
        }
    };
}

sqlx_id!(ProfileId);
sqlx_id!(DeviceId);
sqlx_id!(SessionId);
sqlx_id!(MachineUserId);
sqlx_id!(BindingId);
sqlx_id!(OrgId);
sqlx_id!(IssuerId);
sqlx_id!(ApplicationId);
sqlx_id!(ResourceId);
sqlx_id!(PasswordOperationId);
sqlx_id!(ProvisioningConnectorId);
sqlx_id!(ProvisioningCredentialId);
sqlx_id!(CredentialId);
sqlx_id!(OtpSessionId);
sqlx_id!(MagicLinkId);
sqlx_id!(ResetSessionId);
sqlx_id!(PrincipalId);
sqlx_id!(ProfileEmailId);
sqlx_id!(ProfilePhoneId);
sqlx_id!(ProjectId);
sqlx_id!(RoleId);
sqlx_id!(GroupId);
sqlx_id!(RoleAssignmentId);
sqlx_id!(CedarPolicyId);
sqlx_id!(AccessRequestId);
