use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    env,
    sync::{Arc, Mutex},
};
use subtle::ConstantTimeEq;

#[derive(Clone)]
struct App {
    db: Arc<Mutex<Connection>>,
    token: [u8; 32],
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(deny_unknown_fields)]
struct Task {
    id: String,
    title: String,
    notes: String,
    due: String,
    priority: u8,
    parent: Option<String>,
    done: bool,
    deleted: bool,
    #[serde(default)]
    revision: i64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Sync {
    cursor: i64,
    changes: Vec<Task>,
}
#[derive(Serialize)]
struct Synced {
    cursor: i64,
    records: Vec<Task>,
    conflicts: Vec<Task>,
}
type Failure = (StatusCode, &'static str);

fn open_db(path: &str) -> rusqlite::Result<Connection> {
    let db = Connection::open(path)?;
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA cache_size=-2048;
        CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS clock(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
        INSERT OR IGNORE INTO clock VALUES(1,0);")?;
    Ok(db)
}

fn synchronize(db: &mut Connection, input: Sync) -> Result<Synced, Failure> {
    let bad = (
        StatusCode::BAD_REQUEST,
        "Invalid task or synchronization request",
    );
    if input.cursor < 0 || input.changes.len() > 500 {
        return Err(bad);
    }
    let mut ids = std::collections::HashSet::new();
    for task in &input.changes {
        if task.id.is_empty()
            || task.id.len() > 100
            || !ids.insert(&task.id)
            || task.title.trim().is_empty()
            || task.title.len() > 1000
            || task.notes.len() > 32000
            || task.due.len() > 40
            || task.priority > 3
            || task.revision < 0
            || task
                .parent
                .as_ref()
                .is_some_and(|p| p == &task.id || p.len() > 100)
        {
            return Err(bad);
        }
    }
    let failure = |_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Database operation failed",
        )
    };
    let tx = db.transaction().map_err(failure)?;
    let mut cursor: i64 = tx
        .query_row("SELECT revision FROM clock WHERE id=1", [], |r| r.get(0))
        .map_err(failure)?;
    if input.cursor > cursor {
        return Err((
            StatusCode::CONFLICT,
            "Server history changed; export local data before reconnecting",
        ));
    }
    let mut conflicts = Vec::new();
    for mut task in input.changes {
        let current = tx.query_row("SELECT body FROM tasks WHERE id=?1", [&task.id], |r| {
            r.get::<_, String>(0)
        });
        match current {
            Ok(body) => {
                let existing: Task = serde_json::from_str(&body)
                    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Stored task is invalid"))?;
                // A lost response may replay the same write. Accept it without another revision.
                let mut replay = task.clone();
                replay.revision = existing.revision;
                if serde_json::to_value(&replay).ok() == serde_json::to_value(&existing).ok() {
                    continue;
                }
                if task.revision != existing.revision {
                    conflicts.push(existing);
                    continue;
                }
            }
            Err(rusqlite::Error::QueryReturnedNoRows) if task.revision == 0 => (),
            Err(rusqlite::Error::QueryReturnedNoRows) => return Err(bad),
            Err(error) => return Err(failure(error)),
        }
        cursor += 1;
        task.revision = cursor;
        let body = serde_json::to_string(&task).map_err(|_| bad)?;
        tx.execute("INSERT INTO tasks VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body", params![task.id, cursor, body]).map_err(failure)?;
    }
    // Reject broken links and cycles before committing any member of the batch.
    {
        let mut statement = tx.prepare("SELECT body FROM tasks").map_err(failure)?;
        let bodies = statement
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(failure)?;
        let mut graph = std::collections::HashMap::new();
        for body in bodies {
            let task: Task = serde_json::from_str(&body.map_err(failure)?).map_err(|_| bad)?;
            if !task.deleted {
                graph.insert(task.id, task.parent);
            }
        }
        for id in graph.keys() {
            let mut visited = std::collections::HashSet::new();
            let mut current = Some(id);
            while let Some(key) = current {
                if !visited.insert(key) {
                    return Err((StatusCode::BAD_REQUEST, "Task tree contains a cycle"));
                }
                current = graph
                    .get(key)
                    .ok_or((StatusCode::BAD_REQUEST, "Parent task is missing or deleted"))?
                    .as_ref();
            }
        }
    }
    tx.execute("UPDATE clock SET revision=?1 WHERE id=1", [cursor])
        .map_err(failure)?;
    let records = {
        let mut statement = tx
            .prepare("SELECT body FROM tasks WHERE revision>?1 ORDER BY revision")
            .map_err(failure)?;
        let bodies = statement
            .query_map([input.cursor], |row| row.get::<_, String>(0))
            .map_err(failure)?;
        let mut records = Vec::new();
        for body in bodies {
            records.push(serde_json::from_str(&body.map_err(failure)?).map_err(|_| bad)?);
        }
        records
    };
    tx.commit().map_err(failure)?;
    Ok(Synced {
        cursor,
        records,
        conflicts,
    })
}

async fn sync(
    State(app): State<App>,
    headers: HeaderMap,
    Json(input): Json<Sync>,
) -> Result<Json<Synced>, Failure> {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    let digest: [u8; 32] = Sha256::digest(token.as_bytes()).into();
    if !bool::from(app.token.ct_eq(&digest)) {
        return Err((
            StatusCode::UNAUTHORIZED,
            "Unlock sync with your private token",
        ));
    }
    // SQLite work runs outside the async runtime; one bounded connection suits personal use.
    tokio::task::spawn_blocking(move || {
        let mut db = app
            .db
            .lock()
            .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Database unavailable"))?;
        synchronize(&mut db, input).map(Json)
    })
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Sync unavailable"))?
}

async fn asset(uri: axum::http::Uri) -> Response {
    let (bytes, mime): (&[u8], &str) = match uri.path() {
        "/" => (include_bytes!("../index.html"), "text/html; charset=utf-8"),
        "/styles.css" => (include_bytes!("../styles.css"), "text/css"),
        "/interactions.js" => (include_bytes!("../interactions.js"), "text/javascript"),
        "/install.js" => (include_bytes!("../install.js"), "text/javascript"),
        "/app/" | "/app" => (
            include_bytes!("../app/index.html"),
            "text/html; charset=utf-8",
        ),
        "/app/app.js" => (include_bytes!("../app/app.js"), "text/javascript"),
        "/app/app.css" => (include_bytes!("../app/app.css"), "text/css"),
        "/sw.js" => (include_bytes!("../sw.js"), "text/javascript"),
        "/manifest.webmanifest" => (
            include_bytes!("../manifest.webmanifest"),
            "application/manifest+json",
        ),
        "/favicon.svg" => (include_bytes!("../favicon.svg"), "image/svg+xml"),
        "/icons/icon-192.png" => (include_bytes!("../icons/icon-192.png"), "image/png"),
        "/icons/icon-512.png" => (include_bytes!("../icons/icon-512.png"), "image/png"),
        _ => return StatusCode::NOT_FOUND.into_response(),
    };
    (
        [
            (header::CONTENT_TYPE, mime),
            (header::CACHE_CONTROL, "no-cache"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        bytes,
    )
        .into_response()
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let token = env::var("TODO_SYNC_TOKEN")
        .map_err(|_| "Set TODO_SYNC_TOKEN to a random secret of at least 32 characters")?;
    if token.len() < 32 {
        return Err("TODO_SYNC_TOKEN must have at least 32 characters".into());
    }
    let db = open_db(&env::var("TODO_DB").unwrap_or_else(|_| "todo.db".into()))?;
    let app = App {
        db: Arc::new(Mutex::new(db)),
        token: Sha256::digest(token.as_bytes()).into(),
    };
    let router = Router::new()
        .route("/api/health", get(|| async { "ok" }))
        .route("/api/sync", post(sync))
        .fallback(get(asset))
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
        .with_state(app);
    let address = env::var("TODO_LISTEN").unwrap_or_else(|_| "127.0.0.1:8080".into());
    let listener = tokio::net::TcpListener::bind(&address).await?;
    println!("todo listening on http://{address}");
    axum::serve(listener, router)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn task() -> Task {
        Task {
            id: "a".into(),
            title: "First".into(),
            notes: "".into(),
            due: "".into(),
            priority: 0,
            parent: None,
            done: false,
            deleted: false,
            revision: 0,
        }
    }
    #[test]
    fn retry_conflict_and_tombstone() {
        let mut db = open_db(":memory:").unwrap();
        let first = synchronize(
            &mut db,
            Sync {
                cursor: 0,
                changes: vec![task()],
            },
        )
        .unwrap();
        assert_eq!(first.cursor, 1);
        assert_eq!(
            synchronize(
                &mut db,
                Sync {
                    cursor: 0,
                    changes: vec![task()]
                }
            )
            .unwrap()
            .cursor,
            1
        );
        let mut stale = task();
        stale.title = "Other device".into();
        assert_eq!(
            synchronize(
                &mut db,
                Sync {
                    cursor: 0,
                    changes: vec![stale]
                }
            )
            .unwrap()
            .conflicts
            .len(),
            1
        );
        let mut removed = first.records[0].clone();
        removed.deleted = true;
        let result = synchronize(
            &mut db,
            Sync {
                cursor: 1,
                changes: vec![removed],
            },
        )
        .unwrap();
        assert!(result.records[0].deleted);
        assert_eq!(result.cursor, 2);
    }

    #[test]
    fn invalid_tree_rolls_back_batch() {
        let mut db = open_db(":memory:").unwrap();
        let mut a = task();
        a.parent = Some("b".into());
        let mut b = task();
        b.id = "b".into();
        b.parent = Some("a".into());
        assert!(
            synchronize(
                &mut db,
                Sync {
                    cursor: 0,
                    changes: vec![a, b]
                }
            )
            .is_err()
        );
        let empty = synchronize(
            &mut db,
            Sync {
                cursor: 0,
                changes: vec![],
            },
        )
        .unwrap();
        assert_eq!(empty.cursor, 0);
        assert!(empty.records.is_empty());
    }
}
