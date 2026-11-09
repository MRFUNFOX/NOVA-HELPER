// Без консольного окна в релизе на Windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    nova_helper_lib::run()
}
