// Configuration publique du site -- SEULES des valeurs non-secrètes vont
// ici : l'URL du projet Supabase et sa clé "publishable" sont FAITES pour
// être visibles côté navigateur (elles ne donnent aucun accès que les
// policies RLS n'autorisent pas déjà). Ne JAMAIS mettre ici la clé
// "secret" (sb_secret_...) -- celle-là reste uniquement dans les secrets
// de la Edge Function, côté serveur.

const SUPABASE_URL = "https://dvknfvvrqyckimzsvgpm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_JbdnSPEnPwfmCBwyrysnGw_8EGTHkbA";

// URL de base de la fonction serveur (même projet Supabase).
const API_BASE = `${SUPABASE_URL}/functions/v1/license-api`;
