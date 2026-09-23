# ADR 0019 — Empilement de l’interface et infobulles

- Statut : accepté
- Date : 2026-09-23
- Complète : ADR 0009 (parité d’expérience bureau/web) et ADR 0011
- Plan : aucun plan de dépôt ; tranches verticales issues de l’audit UI du frontend

## Contexte

Le client utilise PrimeVue en mode `unstyled` : le kit ne fournit que le
comportement JavaScript, aucun style. Les overlays (palette de recherche,
panneau de réglages, aperçus de pièce jointe, menu contextuel des notes,
notifications) étaient donc écrits à la main avec des `position: fixed` et des
valeurs `z-index` littérales. Deux collisions existaient — `40` pour la palette
de recherche et `40` pour les réglages, `1100` pour le menu contextuel, les
notifications et l’overlay du `Select` — et, à valeur égale, l’ordre du DOM
décidait : la palette de recherche s’affichait sous l’aperçu de pièce jointe.

Les infobulles étaient des attributs HTML `title`. Une infobulle native est
dessinée par le navigateur ou le système hors de l’arbre d’empilement : elle ne
se ferme pas quand un menu s’ouvre par-dessus, elle ignore le thème et elle ne
peut pas être mise en forme. La directive `primevue/tooltip` n’était pas
enregistrée.

Aucun ADR ne couvrait le design system, et `README.md` annonçait « Tailwind CSS
or UnoCSS » alors que ni l’un ni l’autre n’est installé.

## Décision

1. PrimeVue reste en `unstyled` et la présentation appartient au dépôt. Aucun
   preset de thème externe n’est ajouté : les composants du kit sont habillés par
   les attributs `data-pc-*` et les jetons CSS du dépôt.
2. L’échelle `--synapse-z-*` de `packages/ui/src/styles/tokens.css` est la seule
   source d’empilement. Les overlays applicatifs vivent dans la bande
   `--synapse-z-overlay` ; les overlays internes de PrimeVue, téléportés dans
   `body` avec un `style.zIndex` en ligne, occupent la bande réservée plus haute
   `--synapse-z-primevue-*`, configurée par
   `app.use(PrimeVue, { zIndex: { overlay, menu, modal, tooltip } })`. Un test
   (`packages/ui/src/ui-layering.spec.ts`) refuse toute valeur littérale.
3. Une pile d’overlays partagée (`packages/ui/src/overlay-stack.ts`) possède
   l’empilement, Échap et le verrou de défilement. La profondeur est dérivée de
   l’ordre d’ouverture et injectée par
   `z-index: calc(var(--synapse-z-overlay) + depth)`. Un unique écouteur de
   `document` en phase de capture envoie Échap au seul overlay du dessus et
   consomme l’événement, de sorte qu’un Échap ne ferme plus tous les dialogues
   ouverts. Le verrou de défilement est compté par référence pour qu’un overlay
   imbriqué ne libère pas le défilement des autres.
   `DialogFocusController` conserve le focus initial, le piège de tabulation, le
   piège `focusin` et la restitution du focus à l’ouvreur ; son `onEscape` devient
   optionnel pour qu’un overlay empilé délègue Échap à la pile au lieu d’en
   devenir un second propriétaire.
4. Les infobulles passent par la directive `v-synapse-tooltip`, qui alimente un
   élément unique `role="tooltip"` ajouté au `body`, positionné en `fixed` avec
   bascule au-dessus ou en dessous du déclencheur, et refermé sur `pointerdown`,
   `keydown`, `scroll`, `resize` et `blur`. L’attribut `title` est interdit hors
   `<iframe>`, où il reste le nom accessible obligatoire du cadre.
5. Pas de `Teleport` pour les overlays applicatifs. Aucun ancêtre ne crée de bloc
   conteneur pour un descendant `position: fixed` (aucun `transform`, `filter`,
   `contain`, `will-change` ni `isolation` sur les ancêtres des vues), donc le
   téléport ne corrige aucun défaut observé, alors qu’il rendrait aveugles les
   tests de composants existants, qui interrogent le wrapper et non le `body`.
   L’introduction d’un ancêtre transformé (animation de vue, panneau filtré)
   devra rouvrir cette décision.
6. Le kit est utilisé dans sa ligne 4.x, sous licence MIT. Le passage à PrimeVue
   5.x — licence PrimeUI, clé de licence obligatoire, plafonds de revenus, de
   développeurs et de financement — et aux paquets `@primeuix/*` 3.x est exclu :
   il introduirait un compte tiers obligatoire, contraire aux règles du dépôt.
   `README.md` décrit désormais le design system réellement utilisé.

## Conséquences

Tout nouvel overlay doit s’enregistrer dans la pile et libérer son handle à la
fermeture : l’oublier laisserait un verrou de défilement et une profondeur
fantôme. Les overlays internes de PrimeVue gardent leur propre gestion
d’empilement et doivent rester cantonnés à leur bande réservée. Les garde-fous
sur les `z-index` littéraux et sur l’attribut `title` échouent en test si une
régression réapparaît. La bande applicative suppose moins de mille overlays
simultanés, ce qui est très au-delà des usages réels.

Le verrou de défilement et la propriété d’Échap ne dépendent d’aucune donnée de
coffre : cette décision ne touche ni le chiffrement, ni le protocole, ni le
stockage.
