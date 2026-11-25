/**
 * register-python.js — JSVisualizer のフロントエンドに Python の言語プロファイルを登録する
 *
 * app.js（src/app.js）より先に評価されるよう、入口で最初に import する。
 * virtual:python-samples はビルド（scripts/build.mjs）が samples/*.py から作る。
 */
import { setLanguage } from 'js-visualizer/src/lang/index.js';
import { createPythonProfile } from './lang/python.js';
import { SAMPLES, SAMPLE_GROUPS, DEFAULT_SAMPLE } from 'virtual:python-samples';

setLanguage(createPythonProfile(SAMPLES, { groups: SAMPLE_GROUPS, defaultSample: DEFAULT_SAMPLE }));
