# Migration-only boundary

All Base44 extraction/adaptation logic lives here or in equivalent migration-only tooling. It must never become a Foundation runtime dependency.

Migration tooling must support dry run, snapshot identity, source/target counts, ID mapping, transform reports, validation, retries, resumability, explicit per-record outcomes and reconciliation. No silent drop.
