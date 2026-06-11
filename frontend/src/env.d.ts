/**
 * Vite 环境变量类型声明。
 *
 * 扩展现有的 ImportMeta 类型，为 import.meta.env 提供类型提示。
 * 当前仅引用 Vite 客户端类型定义，后续可在此添加自定义环境变量的类型声明。
 *
 * @see https://vitejs.dev/guide/env-and-mode.html
 */
/// <reference types="vite/client" />