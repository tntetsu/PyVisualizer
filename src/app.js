/**
 * app.js — PyVisualizer の入口
 *
 * JSVisualizer のフロントエンド（js-visualizer/src/app.js）を、Python の言語プロファイルで起動する。
 * ESM は import を順に評価するので、register-python.js（setLanguage）が app.js より先に動く。
 */
import './register-python.js';
import 'js-visualizer/src/app.js';
