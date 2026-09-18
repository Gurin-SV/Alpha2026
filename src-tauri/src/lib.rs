use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use unicode_normalization::UnicodeNormalization;

#[derive(Serialize)]
struct ArticleRow {
    caption: String,
    html: String,
}

#[derive(Serialize)]
struct KeyRow {
    key: String,
    captions: Vec<String>,
}

#[derive(Serialize)]
struct FtsRow {
    key: String,
    caption: String,
    snippet: String,
}

#[derive(Serialize, Deserialize)]
struct Settings {
    theme: String,
    scale: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            theme: "light".to_string(),
            scale: 100,
        }
    }
}

fn db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let db = resource_dir.join("dictionary.db");
    if db.exists() {
        return Ok(db);
    }
    let dev = PathBuf::from("dictionary.db");
    if dev.exists() {
        return Ok(dev);
    }
    Err(format!("dictionary.db not found near {:?}", resource_dir))
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(Settings::default());
    }
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    match serde_json::from_str::<Settings>(&data) {
        Ok(s) => Ok(s),
        Err(_) => Ok(Settings::default()),
    }
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, theme: String, scale: u32) -> Result<(), String> {
    let path = settings_path(&app)?;
    let s = Settings { theme, scale };
    let data = serde_json::to_string_pretty(&s).map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| e.to_string())
}

fn canonicalize(word: &str) -> String {
    let nfkd: String = word.nfkd().collect();
    let stripped: String = nfkd
        .chars()
        .filter(|c| {
            use unicode_normalization::char::is_combining_mark;
            !is_combining_mark(*c)
        })
        .collect();
    stripped.to_lowercase()
}

#[tauri::command]
fn get_article(app: tauri::AppHandle, key: String) -> Result<Vec<ArticleRow>, String> {
    let path = db_path(&app)?;
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT d.caption, e.html
             FROM entries e
             JOIN dictionaries d ON d.id = e.dictionary_id
             WHERE e.key = ?1
             ORDER BY d.sort_order",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![key], |row| {
            Ok(ArticleRow {
                caption: row.get(0)?,
                html: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

#[tauri::command]
fn search_canonical(app: tauri::AppHandle, word: String) -> Result<Vec<ArticleRow>, String> {
    let path = db_path(&app)?;
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;

    let canonical = canonicalize(&word);

    let mut stmt = conn
        .prepare(
            "SELECT d.caption, e.html
             FROM entries e
             JOIN dictionaries d ON d.id = e.dictionary_id
             WHERE e.key_canonical = ?1
             ORDER BY d.sort_order",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![canonical], |row| {
            Ok(ArticleRow {
                caption: row.get(0)?,
                html: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

#[tauri::command]
fn search_prefix(
    app: tauri::AppHandle,
    prefix: String,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<KeyRow>, String> {
    let path = db_path(&app)?;
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;

    let prefix_canonical = canonicalize(&prefix);
    let prefix_end = format!("{}\u{FFFF}", prefix_canonical);
    let limit = limit.unwrap_or(50);
    let offset = offset.unwrap_or(0);

    // 1. Уникальные ключи страницы
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT key, key_canonical
             FROM entries
             WHERE key_canonical >= ?1
               AND key_canonical < ?2
             ORDER BY key_canonical
             LIMIT ?3 OFFSET ?4",
        )
        .map_err(|e| e.to_string())?;

    let page_keys: Vec<String> = stmt
        .query_map(params![prefix_canonical, prefix_end, limit, offset], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // 2. Для каждого ключа — список словарей
    let mut result: Vec<KeyRow> = Vec::with_capacity(page_keys.len());

    for key in page_keys {
        let mut stmt = conn
            .prepare(
                "SELECT d.caption
                 FROM entries e
                 JOIN dictionaries d ON d.id = e.dictionary_id
                 WHERE e.key = ?1
                 ORDER BY d.sort_order",
            )
            .map_err(|e| e.to_string())?;

        let captions: Vec<String> = stmt
            .query_map(params![key], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        result.push(KeyRow { key, captions });
    }

    Ok(result)
}

#[tauri::command]
fn count_prefix(app: tauri::AppHandle, prefix: String) -> Result<i64, String> {
    let path = db_path(&app)?;
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;

    let prefix_canonical = canonicalize(&prefix);
    let prefix_end = format!("{}\u{FFFF}", prefix_canonical);

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT key)
             FROM entries
             WHERE key_canonical >= ?1
               AND key_canonical < ?2",
            params![prefix_canonical, prefix_end],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(count)
}

#[tauri::command]
fn search_fulltext(
    app: tauri::AppHandle,
    query: String,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<FtsRow>, String> {
    let path = db_path(&app)?;
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;

    let words: Vec<String> = query
        .split_whitespace()
        .map(|w| canonicalize(w))
        .filter(|w| !w.is_empty())
        .collect();

    if words.is_empty() {
        return Ok(Vec::new());
    }

    let fts_query = words.join(" ");
    let limit = limit.unwrap_or(1000);
    let offset = offset.unwrap_or(0);

    let mut stmt = conn
        .prepare(
            "SELECT e.key, d.caption,
                    snippet(entries_fts, 1, '[[', ']]', '…', 16) AS snippet
             FROM entries_fts
             JOIN entries e ON e.id = entries_fts.entry_id
             JOIN dictionaries d ON d.id = e.dictionary_id
             WHERE entries_fts MATCH ?1
             ORDER BY bm25(entries_fts)
             LIMIT ?2 OFFSET ?3",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![fts_query, limit, offset], |row| {
            Ok(FtsRow {
                key: row.get(0)?,
                caption: row.get(1)?,
                snippet: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

#[tauri::command]
fn search_canonical_keys(
    app: tauri::AppHandle,
    word: String,
) -> Result<Vec<KeyRow>, String> {
    let path = db_path(&app)?;
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;

    let canonical = canonicalize(&word);

    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT key
             FROM entries
             WHERE key_canonical = ?1
             ORDER BY key",
        )
        .map_err(|e| e.to_string())?;

    let keys: Vec<String> = stmt
        .query_map(params![canonical], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut result: Vec<KeyRow> = Vec::with_capacity(keys.len());

    for key in keys {
        let mut stmt = conn
            .prepare(
                "SELECT d.caption
                 FROM entries e
                 JOIN dictionaries d ON d.id = e.dictionary_id
                 WHERE e.key = ?1
                 ORDER BY d.sort_order",
            )
            .map_err(|e| e.to_string())?;

        let captions: Vec<String> = stmt
            .query_map(params![key], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        result.push(KeyRow { key, captions });
    }

    Ok(result)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            get_article,
            search_canonical,
            search_canonical_keys,
            search_prefix,
            count_prefix,
            search_fulltext,
            get_settings,
            save_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}