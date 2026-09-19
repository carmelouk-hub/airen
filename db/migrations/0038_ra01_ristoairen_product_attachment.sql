BEGIN;

-- RA-01 registers the tenant-scoped permission required by AOS-03 ProductAccess.
-- It intentionally grants the permission to no role or membership. Authorization
-- policy remains explicit and least-privilege; production enablement is forbidden.
INSERT INTO authz.permission_registry (permission_key, description, sensitivity)
VALUES (
  'ristoairen.access',
  'Enter the RISTOAIREN vertical through the governed AIRenOS Product Attachment entrypoint',
  'normal'
)
ON CONFLICT (permission_key) DO UPDATE
SET description = EXCLUDED.description,
    sensitivity = EXCLUDED.sensitivity;

COMMIT;
