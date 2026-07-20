# Migrating to 0.70.x

0.70.x upgrades newly built collection manifests from schema v1 to v2 and index metadata from v2 to v3. Existing v1 collections remain readable and verifiable. Running `collection sync` upgrades a v1 manifest to v2; running `collection index` writes v3 metadata.

New local commands add deterministic export, bundle verification, import, restore, incremental indexing, and offline automation. `collection favorites` requires the server capability that exposes authenticated readonly favorite-topic export. No 0.70.x collection automation command sends community write requests.
