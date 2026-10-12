/*
 * Point d'accroche — support côté admin (phase 5, SUP-02).
 * Chargé avec defer après /admin/app.js sur /admin/.
 * Peut utiliser les globales supa, esc de admin/app.js.
 * Règles : tout texte venant de la base passe par esc() avant innerHTML ;
 * aucun script externe (CSP script-src 'self') ; ne pas modifier admin/app.js.
 * Vide pour l'instant.
 */
