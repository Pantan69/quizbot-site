// Configuration publique du site (16/09) -- SEULES des valeurs
// non-secrètes vont ici : l'URL du projet Supabase et sa clé "anon" /
// "publishable" sont FAITES pour être visibles côté navigateur (elles ne
// donnent aucun accès que les policies RLS n'autorisent pas déjà). Ne
// JAMAIS mettre ici la clé "service_role" / "secret" -- celle-là reste
// uniquement dans les secrets de la Edge Function, côté serveur.
//
// Où trouver ces valeurs : Dashboard Supabase -> Project Settings -> API
//   - Project URL              -> SUPABASE_URL
//   - anon / public key        -> SUPABASE_ANON_KEY
//     (ou "Publishable key" dans la nouvelle interface Supabase)

const SUPABASE_URL = "REMPLACE_MOI_SUPABASE_URL";
const SUPABASE_ANON_KEY = "REMPLACE_MOI_SUPABASE_ANON_KEY";

// URL de base de la fonction serveur (même projet Supabase).
const API_BASE = `${SUPABASE_URL}/functions/v1/license-api`;
