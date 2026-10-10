# ADR 0022 — Partage E2EE de coffre entre comptes

- Statut : **proposé — non approuvé, aucune implémentation autorisée**
- Date : 2026-10-10
- Complète (si accepté) : ADR 0002 (sync par opérations), ADR 0010 (item chiffré),
  ADR 0011 (client canonique), ADR 0014 (session mémorisée)
- Références : `docs/security/e2ee-design.md`, `docs/security/threat-model.md`,
  roadmap R06

Ce document ouvre la revue de conception exigée par R06. Il ne modifie aucune
frontière de confiance tant qu’il n’est pas accepté. Les points marqués
**Décision ouverte** attendent un arbitrage explicite ; les recommandations sont
celles du rédacteur, pas des décisions.

## Contexte

Aujourd’hui un coffre a un seul détenteur de clé. La clé de coffre aléatoire de
256 bits est enveloppée localement par une clé Argon2id dérivée d’une phrase
secrète, et l’enveloppe opaque est stockée par compte (`vault_user_envelopes`).
La table `vault_members` connaît déjà les rôles `owner`, `writer` et `reader`,
mais aucun mécanisme ne permet de remettre la clé de coffre à un autre compte :
ces tables sont un échafaudage, pas un partage. Les rôles d’administration
d’instance et les invitations de création de compte sont une fonctionnalité
différente.

Le dépôt ne contient aujourd’hui **aucune primitive asymétrique** : ni échange de
clés, ni signature. Tout partage entre comptes en introduit une. C’est le
changement de frontière principal que cet ADR soumet à approbation.

## Modèle de menace retenu

- Le serveur est honnête-mais-curieux pour la confidentialité des contenus, et
  **potentiellement actif** pour la distribution de clés publiques : il peut
  tenter de substituer la clé d’un destinataire.
- Un membre légitime détient la clé de coffre de son époque et peut copier tout
  ce qu’il a déchiffré. Aucune révocation ne reprend ces copies.
- Un ancien membre conserve ses anciennes clés et peut collaborer avec le
  serveur ou accéder à une sauvegarde.
- Restent observables par l’opérateur : graphe d’appartenance, rôles, volumes,
  tailles de ciphertext, horaires et adresses IP.

## Proposition

### 1. Identité de compte

Chaque compte possède une paire de clés d’identité générée sur un client
déverrouillé. La clé publique est publiée sur le serveur ; la clé privée n’y est
stockée que sous forme d’enveloppe opaque, comme les enveloppes de coffre.

**Décision ouverte A — secret protégeant la clé privée d’identité.**

1. _(Recommandé)_ Une phrase secrète de compte dédiée, distincte du mot de passe
   d’authentification, dérivée par Argon2id avec un sel et un contexte propres.
   Cohérent avec l’invariant « le mot de passe ne déchiffre rien ».
2. Réutiliser la phrase secrète d’un coffre existant. Moins de secrets à retenir,
   mais lie l’identité à un coffre particulier et complique le changement de phrase.
3. Clé d’identité par appareil, sans enveloppe serveur. Plus robuste, mais exige
   un protocole d’ajout d’appareil qui dépasse R06.

### 2. Vérification des clés publiques

Le serveur n’est pas une autorité de confiance pour les clés. Avant d’accorder
un accès, le client de l’invitant affiche une empreinte courte de la clé du
destinataire, à comparer hors bande. La clé vérifiée est épinglée localement ;
tout changement ultérieur bloque le partage et exige une nouvelle vérification.

**Décision ouverte B.** Vérification obligatoire avant chaque invitation
_(recommandé)_, ou confiance au premier usage avec avertissement. La seconde
option laisse un serveur actif lire un coffre partagé ; elle devrait alors être
documentée comme telle dans le modèle de menace.

### 3. Remise de la clé de coffre

L’invitant scelle la clé de coffre de l’époque courante pour la clé publique
vérifiée du destinataire. Le contexte authentifié lie au minimum `vault_id`,
identifiant du destinataire, identifiant de l’invitant, rôle accordé, époque de
clé et identifiant d’invitation, afin qu’une enveloppe ne puisse être rejouée
vers un autre coffre, un autre compte ou un autre rôle. Le serveur stocke cette
enveloppe d’invitation opaque. À l’acceptation, le client du destinataire la
descelle, vérifie le contexte, puis ré-enveloppe la clé sous son propre secret
local avec le mécanisme existant.

**Décision ouverte C — construction.** Recommandation : HPKE (RFC 9180) avec
X25519, HKDF-SHA256 et ChaCha20-Poly1305, en mode authentifié, derrière
`crates/synapse-crypto/` côté Rust et un module unique côté client. Alternative :
boîtes scellées libsodium. Dans les deux cas, bibliothèques maintenues
uniquement, aucun cadrage maison ; le choix exact des paquets, leur licence et
leur état d’audit sont à vérifier avant acceptation et ne sont pas affirmés ici.

### 4. Rôles

Le serveur applique `owner`, `writer` et `reader` sur chaque route de lecture,
d’écriture, d’enveloppe, de blob et de notification. Limite assumée : tout membre
détient la même clé symétrique, donc un `reader` complice du serveur pourrait
fabriquer un contenu valide. Le rôle lecteur est une autorisation serveur, pas
une garantie cryptographique.

**Décision ouverte D.** Accepter cette limite _(recommandé pour une première
version)_, ou signer chaque opération avec une clé d’auteur pour que les clients
rejettent les écritures d’un non-rédacteur. La signature ajoute une seconde
primitive et un changement de protocole.

### 5. Rotation et révocation

Retirer un membre supprime immédiatement son autorisation serveur et son
enveloppe, puis déclenche une rotation : un propriétaire génère une nouvelle clé
de coffre (époque `n+1`) et la scelle pour chaque membre restant.

**Décision ouverte E — étendue de la rotation.**

1. _(Recommandé)_ Époques de clé : les nouvelles révisions sont chiffrées sous
   la nouvelle époque ; les anciennes révisions restent lisibles avec les
   anciennes clés, conservées par les membres restants. L’ancien membre ne lit
   rien de nouveau. Exige un champ d’époque dans l’item chiffré et son AAD, donc
   une révision d’ADR 0010 et du protocole.
2. Re-chiffrement intégral du coffre. Ne protège pas mieux ce que l’ancien membre
   a déjà lu, coûte un transfert complet et doit survivre à une interruption.

Dans les deux cas, la documentation doit dire que la révocation n’efface ni les
copies déjà déchiffrées ni l’accès à d’anciennes sauvegardes serveur.

### 6. Transitions et cas limites

- **Membre hors ligne avec des opérations en attente :** ses opérations chiffrées
  sous une époque périmée sont refusées comme obsolètes. S’il est toujours
  membre, il récupère la nouvelle enveloppe, re-chiffre localement et repousse
  avec les mêmes `operation_id`. S’il a été retiré, son travail reste dans sa
  file locale, visible et exportable, jamais supprimé silencieusement.
- **Rotation interrompue :** la nouvelle époque ne devient active qu’une fois
  les enveloppes de tous les membres restants durables ; avant cela l’ancienne
  époque reste la seule acceptée.
- **Anciens clients :** un client qui ne connaît pas les époques ne peut pas
  ouvrir un coffre partagé ; il reçoit une erreur explicite demandant la mise à
  jour, jamais un déchiffrement partiel.
- **Propriété :** un coffre garde toujours au moins un propriétaire. Le transfert
  est une promotion explicite suivie d’une rétrogradation.
- **Suppression de compte :** équivaut à un retrait de chaque coffre partagé,
  avec rotation. Elle est refusée tant que le compte est seul propriétaire d’un
  coffre ayant d’autres membres.

## Hors périmètre

Partage par dossier ou par note, liens publics, édition temps réel (R08),
récupération de phrase perdue (R10), ajout d’appareil par clé matérielle,
fédération entre instances.

## Conséquences si accepté

- Première primitive asymétrique du projet : nouvelle dépendance à justifier
  (rôle, licence, maintenance) et à encapsuler.
- Le serveur apprend qui partage quoi avec qui ; c’est une métadonnée nouvelle à
  inscrire au modèle de menace.
- ADR 0010 et le schéma de protocole évoluent si les époques sont retenues.
- La perte du secret d’identité empêche d’accepter de nouvelles invitations, et
  la perte de toutes les enveloppes rend un coffre partagé irrécupérable pour ce
  compte : aucun séquestre serveur n’est ajouté.

## Gates avant implémentation

1. Arbitrage écrit des décisions A à E et mise à jour du modèle de menace.
2. Choix des bibliothèques avec licence, maintenance et audit vérifiés.
3. Contrats versionnés et migrations additives, sans changement de comportement
   pour les coffres à membre unique.
4. Tests adverses multi-comptes contre une vraie PostgreSQL jetable : compte non
   affilié, écriture d’un lecteur, invitation forgée ou rejouée, clé publique
   substituée, appartenance révoquée ou périmée.
5. Tests d’interruption : rotation partielle, retour hors ligne, deux
   propriétaires concurrents, ancien client.
6. Vérification qu’aucune clé, phrase ou contenu clair n’apparaît dans les
   requêtes, la base, les blobs, les logs ou les métriques.
