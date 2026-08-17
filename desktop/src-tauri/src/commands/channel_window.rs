use tauri::State;

use crate::{app_state::AppState, models::ChannelPageCursor, relay::query_relay};

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveThreadCursor {
    pub latest_activity_at: i64,
    pub root_id: String,
}

fn build_active_threads_filter(
    channel_id: &str,
    active_since: Option<i64>,
    limit: u32,
    cursor: Option<&ActiveThreadCursor>,
    included_root_ids: &[String],
) -> serde_json::Value {
    let mut filter = serde_json::json!({
        "kinds": TIMELINE_KINDS,
        "#h": [channel_id],
        "limit": limit.clamp(1, 200),
        "thread_roots_by_activity": true,
        "include_thread_roots": included_root_ids,
    });
    if let Some(value) = active_since {
        filter["thread_active_since"] = value.into();
    }
    if let Some(value) = cursor {
        filter["thread_activity_cursor"] = value.latest_activity_at.into();
        filter["thread_activity_cursor_id"] = value.root_id.clone().into();
    }
    filter
}

const TIMELINE_KINDS: [u32; 11] = [
    9,
    40002,
    40008,
    40099,
    43001,
    43002,
    43003,
    43004,
    43005,
    43006,
    buzz_core_pkg::kind::KIND_HUDDLE_STARTED,
];

fn build_channel_window_filter(
    channel_id: &str,
    cap: u32,
    cursor: Option<&ChannelPageCursor>,
) -> serde_json::Value {
    let mut filter = serde_json::Map::new();
    filter.insert("#h".to_string(), serde_json::json!([channel_id]));
    filter.insert("kinds".to_string(), serde_json::json!(TIMELINE_KINDS));
    filter.insert("limit".to_string(), serde_json::json!(cap));
    filter.insert("top_level".to_string(), serde_json::json!(true));
    filter.insert("include_summaries".to_string(), serde_json::json!(true));
    filter.insert("include_aux".to_string(), serde_json::json!(true));
    if let Some(cursor) = cursor {
        filter.insert("until".to_string(), serde_json::json!(cursor.created_at));
        filter.insert("before_id".to_string(), serde_json::json!(cursor.event_id));
    }
    serde_json::Value::Object(filter)
}

/// Fetch one server-assembled channel window over the existing `/query` bridge.
#[tauri::command]
pub async fn get_channel_window(
    channel_id: String,
    limit_rows: Option<u32>,
    cursor: Option<ChannelPageCursor>,
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let filter = build_channel_window_filter(
        &channel_id,
        limit_rows.unwrap_or(50).min(200),
        cursor.as_ref(),
    );
    Ok(query_relay(&state, &[filter])
        .await?
        .iter()
        .filter_map(|event| serde_json::to_value(event).ok())
        .collect())
}

#[tauri::command]
pub async fn get_active_threads(
    channel_id: String,
    active_since: Option<i64>,
    limit_rows: Option<u32>,
    cursor: Option<ActiveThreadCursor>,
    included_root_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let filter = build_active_threads_filter(
        &channel_id,
        active_since,
        limit_rows.unwrap_or(50),
        cursor.as_ref(),
        &included_root_ids,
    );
    Ok(query_relay(&state, &[filter])
        .await?
        .iter()
        .filter_map(|event| serde_json::to_value(event).ok())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_thread_filter_carries_authoritative_bounds_and_pins() {
        let filter = build_active_threads_filter(
            "channel",
            Some(100),
            50,
            Some(&ActiveThreadCursor {
                latest_activity_at: 200,
                root_id: "01".repeat(32),
            }),
            &["02".repeat(32)],
        );
        assert_eq!(filter["thread_roots_by_activity"], true);
        assert_eq!(filter["thread_active_since"], 100);
        assert_eq!(filter["thread_activity_cursor"], 200);
        assert_eq!(
            filter["include_thread_roots"]
                .as_array()
                .expect("pins")
                .len(),
            1
        );
    }
}
