import { mount } from "svelte";
import App from "./lib/App.svelte";
import "./style.css";

const target = document.getElementById("app");
if (!target) throw new Error("#app が見つかりません");

mount(App, { target });
