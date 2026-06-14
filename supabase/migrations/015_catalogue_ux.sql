-- Soglia ricerca prodotti per tenant
-- Sotto questa soglia: ricerca client-side (istantanea)
-- Sopra questa soglia: ricerca server-side (futura)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS catalogue_search_threshold
    integer NOT NULL DEFAULT 500;

-- Nessun GRANT aggiuntivo necessario:
-- getTenant() fa SELECT * ed è già autorizzato
