# README — Odoo Knowledge → RAG

## Objectif

Convertir un export Odoo Knowledge en JSON propre pour RAG support.

---

## Pipeline

1. Créer une action Odoo listant les articles Knowledge.
2. Filtrer sur le périmètre voulu, ex. **Engagement**.
3. Exporter en CSV.
4. Convertir CSV → JSON.
5. Nettoyer avec `odoo-knowledge-cleaner`.
6. Optionnel : qualifier chaque article via OpenAI nano.
7. Merger les qualifications par `id`.
8. Exporter le JSON final.

---

## Nettoyage

Supprimer :

* articles inactifs ;
* articles vides ;
* pages menu/index ;
* images base64 ;
* champs inutiles : `active`, `display_name`, `sequence`, `body_text`.

Transformer :

* HTML → Markdown ;
* parent → `categorie` ;
* dates → ISO ;
* données sensibles → `[..._REDACTED]`.

---

## Qualification IA

Ajoute :

```json
{
  "level": "N0|N1|N2|UNKNOWN",
  "tags": ["tag1", "tag2"],
  "summary": "Résumé court."
}
```

Niveaux :

* `N0` : usage client / explication simple.
* `N1` : procédure support standard.
* `N2` : procédure technique interne.
* `UNKNOWN` : ambigu ou insuffisant.

---

## Sortie finale

```json
{
  "id": "20",
  "title": "Installation",
  "categorie": "Portail de dépose en ligne",
  "url": "https://...",
  "created_at": "2025-01-07T08:39:30.000Z",
  "updated_at": "2026-04-10T09:19:01.000Z",
  "level": "N2",
  "tags": ["installation", "déploiement"],
  "summary": "Procédure technique interne d’installation.",
  "body_markdown": "# Installation\n\n..."
}
```
