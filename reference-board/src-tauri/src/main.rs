#![cfg_attr(windows, windows_subsystem = "windows")]

use std::net::{TcpListener, TcpStream};
use std::fs::OpenOptions;
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::sync::Mutex;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

struct Backend(Mutex<Child>);
struct LibraryPath(PathBuf);

#[tauri::command]
async fn open_workspace_window(app: tauri::AppHandle, window: tauri::WebviewWindow, library: tauri::State<'_, LibraryPath>, tool: String, session: String, peer: String) -> Result<(), String> {
    if window.label() != "main" || !["gallery", "board"].contains(&tool.as_str()) ||
       ![&session, &peer].iter().all(|value| value.len() == 36 && value.chars().all(|ch| ch.is_ascii_hexdigit() || ch == '-')) {
        return Err("工作区窗口参数无效".into());
    }
    let mut address = window.url().map_err(|error| error.to_string())?;
    if address.scheme() != "http" || address.host_str() != Some("127.0.0.1") { return Err("工作区来源无效".into()); }
    address.set_path("/");address.set_query(None);address.set_fragment(None);
    address.query_pairs_mut().append_pair("tool", &tool).append_pair("owner", &session).append_pair("peer", &peer);
    let label = format!("workspace-{peer}");
    tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::External(address))
        .data_directory(library.0.join("webview"))
        .disable_drag_drop_handler()
        .title(if tool == "board" { "画板 · 独立窗口" } else { "图集 · 独立窗口" })
        .inner_size(1180.0, 820.0).min_inner_size(760.0, 560.0)
        .build().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn close_workspace_window(window: tauri::WebviewWindow) -> Result<(), String> {
    if !window.label().starts_with("workspace-") { return Err("只能关闭已交接的独立工作区".into()); }
    window.close().map_err(|error| error.to_string())
}

#[tauri::command]
async fn open_search_window(app: tauri::AppHandle, provider_id: String, query: String, image_data: Option<String>) -> Result<(), String> {
    let providers: serde_json::Value = serde_json::from_str(include_str!("../../search-providers.json")).map_err(|error| error.to_string())?;
    let provider = providers.as_array().and_then(|items| items.iter().find(|item| item["id"].as_str() == Some(provider_id.as_str()))).ok_or("搜索网站不存在")?;
    let home = provider["home"].as_str().ok_or("搜索地址无效")?;
    let mut address: tauri::Url = home.parse().map_err(|_| "搜索地址无效")?;
    if !query.is_empty() {
        if query.len() > 1200 { return Err("搜索关键词过长".into()); }
        let template = provider["keyword"].as_str().ok_or("此网站请使用图搜图")?;
        let mut encoded = String::new();
        for byte in query.as_bytes() {
            if byte.is_ascii_alphanumeric() || b"-._~".contains(byte) { encoded.push(*byte as char); }
            else { encoded.push_str(&format!("%{byte:02X}")); }
        }
        address = template.replace("{query}", &encoded).parse().map_err(|_| "搜索地址无效")?;
    }
    if address.scheme() != "https" { return Err("搜索地址无效".into()); }
    let job_id = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_nanos().to_string();
    let mut script = String::new();
    if let Some(data) = image_data {
        if provider["image"].as_bool() != Some(true) { return Err("此网站请使用关键词搜索".into()); }
        if data.is_empty() || data.len() > 8 * 1024 * 1024 || !data.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"+/=".contains(&byte)) { return Err("检索图片无效或过大".into()); }
        let job = serde_json::json!({"id":job_id, "provider":provider, "data":data});
        script = format!("{}\nwindow.__journalFillSearchImage({job});", include_str!("../../image-search-autofill.js"));
    }
    let label = format!("image-search-{job_id}");
    let mut builder = tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::External(address))
        .title(format!("{} · 图片搜索", provider["name"].as_str().unwrap_or("图集")))
        .inner_size(1120.0, 820.0).min_inner_size(640.0, 480.0)
        .disable_drag_drop_handler();
    if !script.is_empty() { builder = builder.initialization_script(&script); }
    builder.build().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn drag_images_out(window: tauri::WebviewWindow, library: tauri::State<'_, LibraryPath>, ids: Vec<String>) -> Result<(), String> {
    if ids.is_empty() || ids.len() > 100 { return Err("请选择要拖出的图片".into()); }
    let content = std::fs::read(library.0.join("library.json")).map_err(|error| error.to_string())?;
    let state: serde_json::Value = serde_json::from_slice(&content).map_err(|error| error.to_string())?;
    let images = state["images"].as_array().ok_or("图库数据无效")?;
    let export_dir = std::env::temp_dir().join(format!("field-journal-drag-{}-{}",
        std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_nanos()));
    std::fs::create_dir_all(&export_dir).map_err(|error| error.to_string())?;
    let mut files = Vec::new();
    for (index, id) in ids.iter().enumerate() {
        let image = images.iter().find(|image| image["id"].as_str() == Some(id.as_str())).ok_or("图片不存在")?;
        let ext = image["ext"].as_str().ok_or("图片格式无效")?;
        if id.len() != 36 || !id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') ||
           !ext.starts_with('.') || ext.len() > 10 || !ext[1..].chars().all(|c| c.is_ascii_alphanumeric()) {
            return Err("图片路径无效".into());
        }
        let original_name = image["originalName"].as_str().unwrap_or("image");
        let name = Path::new(original_name).file_name().and_then(|part| part.to_str()).unwrap_or("image");
        let name: String = name.chars().map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { '_' } else { c }).collect();
        let name = if name.to_ascii_lowercase().ends_with(&ext.to_ascii_lowercase()) { name } else { format!("{name}{ext}") };
        let target = export_dir.join(format!("{}-{}", index + 1, name));
        let stored = image["storagePath"].as_str().map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(format!("{id}{ext}")));
        if !stored.components().all(|part| matches!(part, Component::Normal(_))) {
            return Err("图片路径无效".into());
        }
        std::fs::copy(library.0.join("media").join(stored), &target).map_err(|error| error.to_string())?;
        files.push(target);
    }
    let drag_window = window.clone();
    window.run_on_main_thread(move || {
        if let Err(error) = drag::start_drag(&drag_window, drag::DragItem::Files(files),
            drag::Image::Raw(include_bytes!("../icons/icon.png").to_vec()), |_, _| {}, Default::default()) {
            let message = serde_json::to_string(&error.to_string()).unwrap_or_else(|_| "\"原生拖放失败\"".into());
            let _ = drag_window.eval(&format!("window.dispatchEvent(new CustomEvent('journal-drag-error', {{ detail: {message} }}))"));
        }
    }).map_err(|error| error.to_string())
}

#[tauri::command]
fn quit_for_update(app: tauri::AppHandle) {
    if let Ok(mut backend) = app.state::<Backend>().0.lock() { let _ = backend.kill(); }
    app.exit(0);
}

fn main() {
    let diagnostic_dir = std::env::var_os("REFERENCE_BOARD_DATA_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let _ = std::fs::create_dir_all(&diagnostic_dir);
    std::panic::set_hook(Box::new({
        let diagnostic_dir = diagnostic_dir.clone();
        move |panic| {
            let _ = std::fs::write(diagnostic_dir.join("desktop-error.log"), panic.to_string());
        }
    }));
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![drag_images_out, open_search_window, open_workspace_window, close_workspace_window, quit_for_update])
        .setup(|app| {
            let listener = TcpListener::bind("127.0.0.1:0")?;
            let port = listener.local_addr()?.port();
            drop(listener);
            let runtime = app.path().resource_dir()?.join("runtime");
            let previous = std::env::var_os("APPDATA")
                .map(|root| std::path::PathBuf::from(root).join("探索者图集").join("library"));
            let data = std::env::var_os("REFERENCE_BOARD_DATA_DIR")
                .map(std::path::PathBuf::from)
                .or_else(|| previous.filter(|folder| folder.join("library.json").exists()))
                .unwrap_or(app.path().app_data_dir()?.join("library"));
            std::fs::create_dir_all(&data)?;
            app.manage(LibraryPath(data.clone()));
            let webview_data = data.join("webview");
            let log = OpenOptions::new().create(true).append(true).open(data.join("service.log"))?;
            let errors = log.try_clone()?;
            let mut command = Command::new(runtime.join("node.exe"));
            command.arg("server.js")
                .env("PORT", port.to_string())
                .env("REFERENCE_BOARD_DATA_DIR", &data)
                .env("TAURI_BACKEND", "1")
                .env("REFERENCE_BOARD_DESKTOP_PID", std::process::id().to_string())
                .env("REFERENCE_BOARD_DESKTOP_EXE", std::env::current_exe()?)
                .current_dir(&runtime)
                .stdin(Stdio::null())
                .stdout(Stdio::from(log))
                .stderr(Stdio::from(errors));
            #[cfg(windows)]
            command.creation_flags(0x08000000);
            let child = command.spawn()?;
            app.manage(Backend(Mutex::new(child)));
            let ready = (0..100).any(|_| {
                if TcpStream::connect_timeout(&format!("127.0.0.1:{port}").parse().unwrap(), Duration::from_millis(100)).is_ok() {
                    true
                } else {
                    std::thread::sleep(Duration::from_millis(50));
                    false
                }
            });
            if !ready { return Err("The local gallery service did not start".into()); }
            let address = format!("http://127.0.0.1:{port}/");
            let window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External(address.parse()?),
            )
            .data_directory(webview_data)
            .disable_drag_drop_handler()
            .title("图集画板")
            .inner_size(1360.0, 900.0)
            .min_inner_size(760.0, 560.0)
            .build().map_err(|error| {
                if let Ok(mut backend) = app.state::<Backend>().0.lock() {
                    let _ = backend.kill();
                }
                error
            })?;
            let handle = app.handle().clone();
            window.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    if let Ok(mut backend) = handle.state::<Backend>().0.lock() {
                        let _ = backend.kill();
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| {
            let data = std::env::var_os("REFERENCE_BOARD_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(std::env::temp_dir);
            let _ = std::fs::write(data.join("desktop-error.log"), error.to_string());
        });
}
