//! O que fica no aparelho: o par de tokens (chaveiro do SO, com o SQLite de
//! reserva), o `device_id` e o espelho do último perfil lido.
//!
//! Os tokens seguem o mesmo caminho dos segredos do scraper
//! (`credentials::SecretStore`, conta `alvanista`, o par em JSON). Se o
//! chaveiro falha, o par vai para `secret_fallback`, e a leitura (`load`)
//! diz de onde ele veio, para a tela poder dizer que a sessão está menos
//! protegida.
//!
//! Cada cópia leva `saved_at` (milissegundos, crescente no processo). Como o
//! chaveiro pode falhar só numa gravação e continuar legível, as duas cópias
//! podem divergir; a leitura devolve sempre a mais nova, porque o refresh
//! token da mais velha já foi gasto no servidor.
//!
//! O marcador `session` em `alvanista_state` diz se há sessão. Sem ele
//! ninguém lê o chaveiro nem chama a rede: num chaveiro trancado do Linux a
//! leitura pode pedir a senha, e quem nunca conectou não pode ser incomodado.
//! Ele entra antes do par ao conectar e sai quando a sessão acaba.

use super::client::Me;
use super::pkce::random_token;
use crate::credentials::SecretStore;
use db::AlvanistaRepo;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

const ACCOUNT: &str = "alvanista";
const DEVICE_ID_KEY: &str = "device_id";
const MIRROR_KEY: &str = "mirror";
/// Marcador de sessão (ver o topo do arquivo). O valor não importa.
const SESSION_KEY: &str = "session";
/// Quando a sessão começou (segundos Unix, em texto). Nasce com o marcador e
/// sai com ele; sessões anteriores a esta chave não a têm.
const CONNECTED_AT_KEY: &str = "connected_at";

/// Uma renovação (ou desconexão) por vez em todo o processo, mesmo que
/// existam vários `Client`/`Store`.
pub(super) static REFRESH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Uma rotação feita neste processo: o refresh token gasto, o par novo e o
/// carimbo de quando ele chegou (na mesma escala do `saved_at`).
struct Rotation {
    spent: String,
    new: Tokens,
    received_at: i64,
}

/// Rotações feitas neste processo, as mais recentes. Valem mesmo quando a
/// gravação do par novo falhou.
static ROTATIONS: std::sync::Mutex<Vec<Rotation>> = std::sync::Mutex::new(Vec::new());
const ROTATIONS_KEPT: usize = 8;

pub(super) fn remember_rotation(spent_refresh: &str, new: &Tokens) {
    if let Ok(mut all) = ROTATIONS.lock() {
        all.push(Rotation {
            spent: spent_refresh.to_owned(),
            new: new.clone(),
            received_at: next_stamp(),
        });
        if all.len() > ROTATIONS_KEPT {
            all.remove(0);
        }
    }
}

/// O par mais novo que sucedeu a `spent_refresh`, se foi este processo que
/// o trocou (segue a cadeia se o par novo também já foi trocado), com o
/// carimbo de quando chegou.
pub(super) fn rotated_from(spent_refresh: &str) -> Option<(Tokens, i64)> {
    let all = ROTATIONS.lock().ok()?;
    let mut found: Option<(Tokens, i64)> = None;
    let mut key = spent_refresh.to_owned();
    for _ in 0..ROTATIONS_KEPT {
        let Some(next) = all.iter().rev().find(|r| r.spent == key) else {
            break;
        };
        key = next.new.refresh_token.clone();
        found = Some((next.new.clone(), next.received_at));
    }
    found
}

/// `true` se `refresh` é o refresh token de um par que este processo
/// acabou de receber e ainda não gastou.
pub(super) fn is_latest_rotation(refresh: &str) -> bool {
    ROTATIONS.lock().is_ok_and(|all| {
        all.iter().any(|r| r.new.refresh_token == refresh)
            && !all.iter().any(|r| r.spent == refresh)
    })
}

/// Esquece todas as rotações: a sessão acabou ou outra vai começar, e
/// nenhum par antigo pode voltar a ser servido (nem regravado).
fn forget_all_rotations() {
    if let Ok(mut all) = ROTATIONS.lock() {
        all.clear();
    }
}

/// Por que apagar a sessão falhou.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum ClearError {
    /// O chaveiro não deixou apagar (a reserva no SQLite já saiu).
    #[error("chaveiro: {0}")]
    Keyring(String),
    #[error("{0}")]
    Other(String),
}

/// O par de tokens. Nunca vai para o log: o `Debug` esconde os valores.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: String,
}

impl std::fmt::Debug for Tokens {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Tokens(..)")
    }
}

/// O que vai para o chaveiro/banco: o par mais o carimbo de gravação.
#[derive(Serialize, Deserialize)]
struct Saved {
    #[serde(flatten)]
    tokens: Tokens,
    #[serde(default)]
    saved_at: i64,
}

/// O par guardado, com o carimbo e de onde veio. Uma leitura responde as
/// duas perguntas (há sessão? está no SQLite?): num chaveiro trancado do
/// Linux cada leitura pode pedir a senha, então quem chama lê uma vez só.
pub struct Loaded {
    pub tokens: Tokens,
    pub saved_at: i64,
    /// O par veio da reserva no SQLite (o chaveiro falhou).
    pub from_fallback: bool,
}

/// Carimbo em milissegundos, estritamente crescente neste processo (duas
/// gravações no mesmo milissegundo não empatam).
fn next_stamp() -> i64 {
    static LAST: AtomicI64 = AtomicI64::new(0);
    let now = now_millis();
    let mut prev = LAST.load(Ordering::SeqCst);
    loop {
        let next = now.max(prev + 1);
        match LAST.compare_exchange(prev, next, Ordering::SeqCst, Ordering::SeqCst) {
            Ok(_) => return next,
            Err(actual) => prev = actual,
        }
    }
}

pub(super) fn now_secs() -> i64 {
    now_millis() / 1000
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

fn parse_saved(raw: &str, from_fallback: bool) -> Option<Loaded> {
    match serde_json::from_str::<Saved>(raw) {
        Ok(s) => Some(Loaded {
            tokens: s.tokens,
            saved_at: s.saved_at,
            from_fallback,
        }),
        Err(_) => {
            log::warn!("alvanista: sessão guardada ilegível, ignorada");
            None
        }
    }
}

/// Último perfil lido do Alvanista, para mostrar sem rede.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Mirror {
    pub id: String,
    pub username: String,
    pub avatar_url: Option<String>,
    /// Capa do perfil (o banner do drawer de perfil). `default`: espelhos
    /// gravados antes de a capa entrar não têm o campo.
    #[serde(default)]
    pub hero_url: Option<String>,
    #[serde(default)]
    pub bio: Option<String>,
    pub profile_url: String,
    /// O cartão do perfil. `default`: espelhos da primeira versão não o têm.
    #[serde(default)]
    pub card: Option<serde_json::Value>,
    /// Segundos desde a época Unix.
    pub fetched_at: i64,
}

pub type SharedSecrets = Arc<dyn SecretStore + Send + Sync>;

pub struct Store {
    repo: AlvanistaRepo,
    secrets: SharedSecrets,
}

impl Store {
    pub fn new(db: db::Db, secrets: SharedSecrets) -> Self {
        Self {
            repo: AlvanistaRepo::new(db),
            secrets,
        }
    }

    /// Lê as duas cópias e fica com a mais nova (empate: o chaveiro).
    /// Erro de leitura do chaveiro com a reserva vazia é erro, não "sem
    /// conexão": quem chama não pode tratar uma falha como desconectado.
    pub async fn load(&self) -> Result<Option<Loaded>, String> {
        let (keyring, keyring_err) = match self.secrets.get(ACCOUNT) {
            Ok(Some(raw)) => (parse_saved(&raw, false), None),
            Ok(None) => (None, None),
            Err(e) => {
                log::warn!("alvanista: chaveiro indisponível para ler a sessão: {e}");
                (None, Some(e))
            }
        };
        let fallback = self
            .repo
            .fallback_get(ACCOUNT)
            .await
            .map_err(|e| e.to_string())?
            .and_then(|raw| parse_saved(&raw, true));
        match (keyring, fallback) {
            (Some(k), Some(f)) => Ok(Some(if f.saved_at > k.saved_at { f } else { k })),
            (Some(one), None) | (None, Some(one)) => Ok(Some(one)),
            (None, None) => keyring_err.map_or(Ok(None), Err),
        }
    }

    /// `None` se não há conexão. Um par ilegível conta como ausente (o
    /// usuário conecta de novo).
    pub async fn load_tokens(&self) -> Result<Option<Tokens>, String> {
        Ok(self.load().await?.map(|l| l.tokens))
    }

    /// Começa uma sessão nova (depois do `exchange`): sob `REFRESH_LOCK`,
    /// esquece as rotações de qualquer sessão anterior, apaga o espelho que
    /// tenha sobrado, marca a sessão, grava o par e anota quando a sessão
    /// começou. É o caminho do fluxo de conectar.
    ///
    /// O marcador vem antes do par: se o app cair entre os dois, sobra um
    /// marcador sem sessão, que a próxima leitura apaga. Na ordem inversa
    /// sobraria uma sessão que ninguém lê.
    ///
    /// O espelho sai sem impedir a conexão: um que um `mirror_clear` falho
    /// deixou para trás mostraria o nome e o cartão da conta anterior até o
    /// primeiro `/me` desta responder. `connected_at` entra depois do par e
    /// também nunca derruba a conexão: os tokens já foram emitidos, e parar
    /// aqui deixaria no servidor uma concessão que o aparelho não guardou.
    pub async fn start_session(&self, tokens: &Tokens) -> Result<(), String> {
        let _one_at_a_time = REFRESH_LOCK.lock().await;
        forget_all_rotations();
        if let Err(e) = self.mirror_clear().await {
            log::warn!("alvanista: espelho anterior não apagado: {e}");
        }
        self.repo
            .state_set(SESSION_KEY, "1")
            .await
            .map_err(|e| e.to_string())?;
        self.save_tokens(tokens).await?;
        if let Err(e) = self
            .repo
            .state_set(CONNECTED_AT_KEY, &now_secs().to_string())
            .await
        {
            log::warn!("alvanista: data da conexão não gravada: {e}");
        }
        Ok(())
    }

    /// `true` se há sessão marcada. Só lê o SQLite.
    pub async fn has_session(&self) -> Result<bool, String> {
        self.repo
            .state_get(SESSION_KEY)
            .await
            .map(|v| v.is_some())
            .map_err(|e| e.to_string())
    }

    /// A sessão acabou (desconectou, o servidor a encerrou, ou o marcador
    /// ficou sem par): sai o marcador e depois a data da conexão. A data não
    /// sair só vai para o log: nunca pode deixar o marcador para trás.
    pub async fn unmark_session(&self) -> Result<(), String> {
        self.repo
            .state_delete(SESSION_KEY)
            .await
            .map_err(|e| e.to_string())?;
        if let Err(e) = self.repo.state_delete(CONNECTED_AT_KEY).await {
            log::warn!("alvanista: data da conexão não apagada: {e}");
        }
        Ok(())
    }

    /// Quando a sessão começou, em segundos Unix. Só lê o SQLite; `None` se
    /// a sessão é anterior à chave (ou não há sessão).
    pub async fn connected_at(&self) -> Result<Option<i64>, String> {
        let raw = self
            .repo
            .state_get(CONNECTED_AT_KEY)
            .await
            .map_err(|e| e.to_string())?;
        Ok(raw.and_then(|raw| raw.parse().ok()))
    }

    /// Só para dentro do módulo: a renovação (que já segura `REFRESH_LOCK`) e
    /// `start_session`. Quem conecta usa `start_session`; gravar por fora do
    /// lock poderia pisar numa renovação em andamento.
    pub(super) async fn save_tokens(&self, tokens: &Tokens) -> Result<(), String> {
        let json = serde_json::to_string(&Saved {
            tokens: tokens.clone(),
            saved_at: next_stamp(),
        })
        .map_err(|e| e.to_string())?;
        match self.secrets.set(ACCOUNT, &json) {
            Ok(()) => {
                // Se a cópia velha da reserva não sair, ela perde pelo carimbo.
                if let Err(e) = self.repo.fallback_delete(ACCOUNT).await {
                    log::warn!("alvanista: reserva antiga não apagada: {e}");
                }
                Ok(())
            }
            Err(e) => {
                log::warn!("alvanista: chaveiro indisponível, a sessão vai para o banco: {e}");
                // O chaveiro pode ainda guardar o par anterior (gasto).
                let _ = self.secrets.delete(ACCOUNT);
                self.repo
                    .fallback_set(ACCOUNT, &json)
                    .await
                    .map_err(|e| e.to_string())
            }
        }
    }

    /// Apaga a sessão, esperando uma renovação em andamento terminar.
    pub async fn clear_tokens(&self) -> Result<(), ClearError> {
        let _one_at_a_time = REFRESH_LOCK.lock().await;
        self.clear_tokens_unlocked().await
    }

    /// Para quem já segura `REFRESH_LOCK`. Com as duas cópias apagadas, sai
    /// também o marcador; se o chaveiro recusou, ele fica (uma cópia viva
    /// pode ter ficado lá) e quem chama decide.
    pub(super) async fn clear_tokens_unlocked(&self) -> Result<(), ClearError> {
        // Antes de qualquer leitura: mesmo que o chaveiro falhe aqui, nada
        // da sessão que acabou pode sobreviver na memória.
        forget_all_rotations();
        let keyring = self.secrets.delete(ACCOUNT);
        // A reserva primeiro: `Keyring` promete que ela já saiu.
        self.repo
            .fallback_delete(ACCOUNT)
            .await
            .map_err(|e| ClearError::Other(e.to_string()))?;
        // Cópia que não saiu do chaveiro voltaria a carregar como conectado.
        keyring.map_err(ClearError::Keyring)?;
        self.unmark_session().await.map_err(ClearError::Other)
    }

    /// `true` se o par que `load_tokens` devolve está no SQLite porque o
    /// chaveiro falhou. Fora dos testes, quem precisa saber usa o
    /// `from_fallback` da leitura que já fez.
    #[cfg(test)]
    pub async fn using_fallback(&self) -> bool {
        matches!(self.load().await, Ok(Some(l)) if l.from_fallback)
    }

    /// Identificador deste aparelho (16 bytes aleatórios em base64url),
    /// gerado na primeira vez e mantido; o Alvanista separa as sessões por
    /// aparelho com ele. Chamadas simultâneas na primeira vez concordam.
    pub async fn device_id(&self) -> Result<String, String> {
        if let Some(id) = self
            .repo
            .state_get(DEVICE_ID_KEY)
            .await
            .map_err(|e| e.to_string())?
        {
            return Ok(id);
        }
        self.repo
            .state_insert_if_absent(DEVICE_ID_KEY, &random_token(16))
            .await
            .map_err(|e| e.to_string())?;
        self.repo
            .state_get(DEVICE_ID_KEY)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "device_id sumiu depois de gravado".to_owned())
    }

    pub async fn mirror_get(&self) -> Result<Option<Mirror>, String> {
        let raw = self
            .repo
            .state_get(MIRROR_KEY)
            .await
            .map_err(|e| e.to_string())?;
        Ok(raw.and_then(|raw| serde_json::from_str(&raw).ok()))
    }

    /// Grava o espelho e devolve o que ficou gravado. É o único lugar que
    /// decide o cartão: um `/me` sem cartão (servidor antigo, ou `card:
    /// null`) mantém o cartão guardado, mas só se o espelho guardado é da
    /// mesma conta (`id`); o de outra conta nunca aparece ao lado do nome
    /// desta. Só desconectar ou a sessão acabar apaga o cartão.
    pub async fn mirror_put(&self, me: &Me) -> Result<Mirror, String> {
        let card = match &me.card {
            Some(card) => Some(card.clone()),
            None => self
                .mirror_get()
                .await
                .ok()
                .flatten()
                .filter(|m| m.id == me.id)
                .and_then(|m| m.card),
        };
        let mirror = Mirror {
            id: me.id.clone(),
            username: me.username.clone(),
            avatar_url: me.avatar_url.clone(),
            hero_url: me.hero_url.clone(),
            bio: me.bio.clone(),
            profile_url: me.profile_url.clone(),
            card,
            fetched_at: now_secs(),
        };
        let json = serde_json::to_string(&mirror).map_err(|e| e.to_string())?;
        self.repo
            .state_set(MIRROR_KEY, &json)
            .await
            .map_err(|e| e.to_string())?;
        Ok(mirror)
    }

    pub async fn mirror_clear(&self) -> Result<(), String> {
        self.repo
            .state_delete(MIRROR_KEY)
            .await
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
pub(super) mod test_support {
    use super::*;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, AtomicUsize};
    use std::sync::Mutex;

    /// Chaveiro em memória; `broken` simula "sem Secret Service". `events`
    /// (opcional) registra cada gravação, para provar ordem.
    #[derive(Default)]
    pub struct MemSecrets {
        pub secrets: Mutex<HashMap<String, String>>,
        pub broken: bool,
        /// Leitura funciona, mas gravar e apagar falham.
        pub readonly: AtomicBool,
        /// A próxima gravação falha (uma só); a leitura segue funcionando.
        pub fail_next_set: AtomicBool,
        pub events: Option<Arc<Mutex<Vec<String>>>>,
        /// Quantas leituras o chaveiro recebeu (cada uma pode pedir a senha
        /// num chaveiro trancado).
        pub gets: AtomicUsize,
        /// Quantas chamadas de qualquer tipo (ler, gravar, apagar).
        pub calls: AtomicUsize,
    }

    impl SecretStore for MemSecrets {
        fn get(&self, account: &str) -> Result<Option<String>, String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.gets.fetch_add(1, Ordering::SeqCst);
            if self.broken {
                return Err("sem Secret Service".into());
            }
            Ok(self.secrets.lock().unwrap().get(account).cloned())
        }
        fn set(&self, account: &str, secret: &str) -> Result<(), String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if self.broken
                || self.readonly.load(Ordering::SeqCst)
                || self.fail_next_set.swap(false, Ordering::SeqCst)
            {
                return Err("sem Secret Service".into());
            }
            if let Some(events) = &self.events {
                events.lock().unwrap().push("save".into());
            }
            self.secrets
                .lock()
                .unwrap()
                .insert(account.into(), secret.into());
            Ok(())
        }
        fn delete(&self, account: &str) -> Result<(), String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if self.broken || self.readonly.load(Ordering::SeqCst) {
                return Err("sem Secret Service".into());
            }
            self.secrets.lock().unwrap().remove(account);
            Ok(())
        }
    }

    pub async fn store_with(secrets: MemSecrets) -> (Store, Arc<MemSecrets>) {
        let (store, secrets, _) = store_and_db(secrets).await;
        (store, secrets)
    }

    /// Como `store_with`, mais o banco (para conferir outras tabelas).
    pub async fn store_and_db(secrets: MemSecrets) -> (Store, Arc<MemSecrets>, db::Db) {
        let secrets = Arc::new(secrets);
        let db = db::connect_in_memory().await.unwrap();
        (Store::new(db.clone(), secrets.clone()), secrets, db)
    }

    /// Marca a sessão sem gravar par (como um chaveiro que não abre).
    pub async fn mark_session(db: &db::Db) {
        AlvanistaRepo::new(db.clone())
            .state_set(SESSION_KEY, "1")
            .await
            .unwrap();
    }

    /// Grava o espelho cru, como um build anterior o deixou.
    pub async fn put_raw_mirror(db: &db::Db, json: &str) {
        AlvanistaRepo::new(db.clone())
            .state_set(MIRROR_KEY, json)
            .await
            .unwrap();
    }

    /// Os testes que mexem na memória de rotações (que é do processo) ou
    /// desconectam rodam um de cada vez.
    pub static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    pub fn tokens(n: &str) -> Tokens {
        Tokens {
            access_token: format!("alp_{n}"),
            refresh_token: format!("alr_{n}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::*;
    use super::*;

    #[tokio::test]
    async fn store_keeps_tokens_in_keyring_when_it_works() {
        let _serial = SERIAL.lock().await;
        let (store, secrets) = store_with(MemSecrets::default()).await;
        assert_eq!(store.load_tokens().await.unwrap(), None);
        store.save_tokens(&tokens("a")).await.unwrap();
        assert_eq!(store.load_tokens().await.unwrap(), Some(tokens("a")));
        assert!(secrets.secrets.lock().unwrap().contains_key(ACCOUNT));
        assert!(!store.using_fallback().await);
        store.clear_tokens().await.unwrap();
        assert_eq!(store.load_tokens().await.unwrap(), None);
    }

    #[tokio::test]
    async fn store_falls_back_to_sqlite_when_keyring_fails() {
        let _serial = SERIAL.lock().await;
        let (store, _) = store_with(MemSecrets {
            broken: true,
            ..Default::default()
        })
        .await;
        store.save_tokens(&tokens("a")).await.unwrap();
        assert!(store.using_fallback().await);
        assert_eq!(store.load_tokens().await.unwrap(), Some(tokens("a")));
        store.save_tokens(&tokens("b")).await.unwrap();
        assert_eq!(store.load_tokens().await.unwrap(), Some(tokens("b")));
        // O chaveiro quebrado não deixa apagar: erro, mas a reserva sai.
        assert!(store.clear_tokens().await.is_err());
        assert!(!store.using_fallback().await);
    }

    #[tokio::test]
    async fn keyring_save_drops_a_stale_fallback_copy() {
        let db = db::connect_in_memory().await.unwrap();
        let broken = Store::new(
            db.clone(),
            Arc::new(MemSecrets {
                broken: true,
                ..Default::default()
            }),
        );
        broken.save_tokens(&tokens("old")).await.unwrap();
        let healthy = Store::new(db, Arc::new(MemSecrets::default()));
        healthy.save_tokens(&tokens("new")).await.unwrap();
        assert!(!healthy.using_fallback().await);
        assert_eq!(healthy.load_tokens().await.unwrap(), Some(tokens("new")));
    }

    #[tokio::test]
    async fn device_id_is_generated_once_and_url_safe() {
        let (store, _) = store_with(MemSecrets::default()).await;
        let id = store.device_id().await.unwrap();
        assert_eq!(id.len(), 22);
        assert!(id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_'));
        assert_eq!(store.device_id().await.unwrap(), id);
    }

    #[tokio::test]
    async fn mirror_round_trips_and_clears() {
        let (store, _) = store_with(MemSecrets::default()).await;
        assert_eq!(store.mirror_get().await.unwrap(), None);
        let me = Me {
            id: "alva_1".into(),
            username: "toy".into(),
            avatar_url: None,
            hero_url: Some("https://x/hero.png".into()),
            bio: Some("oi".into()),
            profile_url: "https://www.alvanista.com/users/toy".into(),
            card: None,
        };
        store.mirror_put(&me).await.unwrap();
        let m = store.mirror_get().await.unwrap().unwrap();
        assert_eq!((m.id.as_str(), m.username.as_str()), ("alva_1", "toy"));
        assert_eq!(m.avatar_url, None);
        assert_eq!(m.hero_url.as_deref(), Some("https://x/hero.png"));
        assert_eq!(m.bio.as_deref(), Some("oi"));
        assert!(m.fetched_at > 0);
        store.mirror_clear().await.unwrap();
        assert_eq!(store.mirror_get().await.unwrap(), None);
    }

    #[tokio::test]
    async fn a_mirror_saved_before_the_cover_and_bio_still_reads() {
        let (store, _) = store_with(MemSecrets::default()).await;
        store
            .repo
            .state_set(
                MIRROR_KEY,
                r#"{"id":"alva_1","username":"toy","avatar_url":null,"profile_url":"https://www.alvanista.com/users/toy","fetched_at":1}"#,
            )
            .await
            .unwrap();
        let m = store.mirror_get().await.unwrap().unwrap();
        assert_eq!(m.username, "toy");
        assert_eq!((m.hero_url, m.bio), (None, None));
    }

    #[tokio::test]
    async fn newest_copy_wins_when_a_keyring_write_fails_once() {
        let (store, secrets) = store_with(MemSecrets::default()).await;
        store.save_tokens(&tokens("p1")).await.unwrap();
        secrets.fail_next_set.store(true, Ordering::SeqCst);
        store.save_tokens(&tokens("p2")).await.unwrap();

        assert_eq!(store.load_tokens().await.unwrap(), Some(tokens("p2")));
        assert!(store.using_fallback().await);
        // Uma gravação boa depois volta tudo para o chaveiro.
        store.save_tokens(&tokens("p3")).await.unwrap();
        assert_eq!(store.load_tokens().await.unwrap(), Some(tokens("p3")));
        assert!(!store.using_fallback().await);
    }

    #[tokio::test]
    async fn stale_keyring_copy_loses_even_if_it_cannot_be_deleted() {
        let (store, secrets) = store_with(MemSecrets::default()).await;
        store.save_tokens(&tokens("p1")).await.unwrap();
        secrets.readonly.store(true, Ordering::SeqCst);
        store.save_tokens(&tokens("p2")).await.unwrap();
        // O chaveiro ainda tem p1 (nem apagar deu), mas p2 é mais novo.
        assert_eq!(store.load_tokens().await.unwrap(), Some(tokens("p2")));
        assert!(store.using_fallback().await);
    }

    #[tokio::test]
    async fn keyring_read_error_with_empty_fallback_is_an_error() {
        let (store, _) = store_with(MemSecrets {
            broken: true,
            ..Default::default()
        })
        .await;
        assert!(store.load_tokens().await.is_err());
    }

    #[tokio::test]
    async fn clear_fails_when_the_keyring_entry_cannot_be_deleted() {
        let _serial = SERIAL.lock().await;
        let (store, secrets) = store_with(MemSecrets::default()).await;
        store.save_tokens(&tokens("a")).await.unwrap();
        secrets.readonly.store(true, Ordering::SeqCst);
        assert!(store.clear_tokens().await.is_err());
        // A cópia continua ali: não some em silêncio.
        assert_eq!(store.load_tokens().await.unwrap(), Some(tokens("a")));
    }

    #[tokio::test]
    async fn clear_reports_a_fallback_that_did_not_go_before_the_keyring() {
        let _serial = SERIAL.lock().await;
        // Chaveiro sem Secret Service e banco fechado: nenhuma das duas
        // cópias sai. `Keyring` diria que a reserva já saiu, e não saiu.
        let db = db::connect_in_memory().await.unwrap();
        db.close().await;
        let store = Store::new(
            db,
            Arc::new(MemSecrets {
                broken: true,
                ..Default::default()
            }),
        );
        assert!(matches!(
            store.clear_tokens().await,
            Err(ClearError::Other(_))
        ));
    }

    #[test]
    fn tokens_debug_never_shows_the_values() {
        let shown = format!("{:?}", tokens("segredo"));
        assert!(
            !shown.contains("alp_") && !shown.contains("alr_"),
            "{shown}"
        );
    }

    #[tokio::test]
    async fn the_session_marker_follows_the_session() {
        let _serial = SERIAL.lock().await;
        let (store, _) = store_with(MemSecrets::default()).await;
        assert!(!store.has_session().await.unwrap());
        store.start_session(&tokens("m1")).await.unwrap();
        assert!(store.has_session().await.unwrap());
        store.clear_tokens().await.unwrap();
        assert!(!store.has_session().await.unwrap());
    }

    #[tokio::test]
    async fn the_marker_stays_when_the_keyring_refuses_the_delete() {
        let _serial = SERIAL.lock().await;
        let (store, secrets) = store_with(MemSecrets::default()).await;
        store.start_session(&tokens("m2")).await.unwrap();
        secrets.readonly.store(true, Ordering::SeqCst);
        assert!(store.clear_tokens().await.is_err());
        // A cópia viva continua no chaveiro: a sessão não pode sumir da vista.
        assert!(store.has_session().await.unwrap());
    }

    #[tokio::test]
    async fn concurrent_first_device_id_calls_agree() {
        let (store, _) = store_with(MemSecrets::default()).await;
        let (a, b, c) = tokio::join!(store.device_id(), store.device_id(), store.device_id());
        let (a, b, c) = (a.unwrap(), b.unwrap(), c.unwrap());
        assert_eq!(a, b);
        assert_eq!(b, c);
        assert_eq!(store.device_id().await.unwrap(), a);
    }

    #[tokio::test]
    async fn a_mirror_from_piece_1_reads_without_a_card() {
        let (store, _) = store_with(MemSecrets::default()).await;
        store
            .repo
            .state_set(
                MIRROR_KEY,
                r#"{"id":"alva_1","username":"toy","avatar_url":null,"hero_url":null,"bio":null,"profile_url":"https://www.alvanista.com/users/toy","fetched_at":7}"#,
            )
            .await
            .unwrap();
        let m = store.mirror_get().await.unwrap().unwrap();
        assert_eq!((m.username.as_str(), m.fetched_at), ("toy", 7));
        assert_eq!(m.card, None);
        // E a sessão de então não tem data de conexão: nem 0, nem 1970.
        assert_eq!(store.connected_at().await.unwrap(), None);
    }

    #[tokio::test]
    async fn a_null_card_keeps_the_stored_card() {
        let (store, _) = store_with(MemSecrets::default()).await;
        let with_card = Me {
            id: "alva_1".into(),
            username: "toy".into(),
            avatar_url: None,
            hero_url: None,
            bio: None,
            profile_url: "https://www.alvanista.com/users/toy".into(),
            card: Some(serde_json::json!({"ledger": {"hours": 12}})),
        };
        store.mirror_put(&with_card).await.unwrap();
        let without = Me {
            username: "toy2".into(),
            card: None,
            ..with_card.clone()
        };
        store.mirror_put(&without).await.unwrap();
        let m = store.mirror_get().await.unwrap().unwrap();
        assert_eq!(m.username, "toy2");
        assert_eq!(m.card, with_card.card);
        // Um cartão novo substitui o velho.
        let newer = Me {
            card: Some(serde_json::json!({"ledger": {"hours": 13}})),
            ..without
        };
        store.mirror_put(&newer).await.unwrap();
        assert_eq!(store.mirror_get().await.unwrap().unwrap().card, newer.card);
    }

    #[tokio::test]
    async fn connected_at_follows_the_session() {
        let _serial = SERIAL.lock().await;
        let (store, _) = store_with(MemSecrets::default()).await;
        assert_eq!(store.connected_at().await.unwrap(), None);
        store.start_session(&tokens("c1")).await.unwrap();
        let at = store.connected_at().await.unwrap().unwrap();
        assert!(at > 1_700_000_000, "{at}");
        store.unmark_session().await.unwrap();
        assert_eq!(store.connected_at().await.unwrap(), None);
    }

    #[tokio::test]
    async fn starting_a_session_drops_a_stray_mirror() {
        let _serial = SERIAL.lock().await;
        let (store, _) = store_with(MemSecrets::default()).await;
        // O espelho da conta anterior, que um `mirror_clear` falho deixou.
        store
            .mirror_put(&Me {
                id: "A".into(),
                username: "a".into(),
                avatar_url: None,
                hero_url: None,
                bio: None,
                profile_url: "https://www.alvanista.com/users/a".into(),
                card: Some(serde_json::json!({"ledger": {"hours": 99}})),
            })
            .await
            .unwrap();
        store.start_session(&tokens("n1")).await.unwrap();
        assert_eq!(store.mirror_get().await.unwrap(), None);
        assert!(store.has_session().await.unwrap());
        assert!(store.connected_at().await.unwrap().is_some());
    }

    #[tokio::test]
    async fn a_card_is_never_kept_under_another_account() {
        let (store, _) = store_with(MemSecrets::default()).await;
        let a = Me {
            id: "A".into(),
            username: "a".into(),
            avatar_url: None,
            hero_url: None,
            bio: None,
            profile_url: "https://www.alvanista.com/users/a".into(),
            card: Some(serde_json::json!({"ledger": {"hours": 99}})),
        };
        store.mirror_put(&a).await.unwrap();
        let b = Me {
            id: "B".into(),
            username: "b".into(),
            card: None,
            ..a
        };
        let merged = store.mirror_put(&b).await.unwrap();
        assert_eq!(merged.card, None);
        let m = store.mirror_get().await.unwrap().unwrap();
        assert_eq!((m.id.as_str(), m.card), ("B", None));
    }
}
