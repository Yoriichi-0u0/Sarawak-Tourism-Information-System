-- View-only share links for itineraries. Only the SHA-256 digest of the capability token is stored;
-- replacing or revoking a link overwrites or clears the digest.
alter table stis.itinerary add column share_digest text unique;
