"use strict";
/*
 * preload.js — جسر آمن بين الواجهة وقاعدة البيانات
 * يكشف window.fireApi فقط (بدون nodeIntegration)
 */
const { contextBridge, ipcRenderer } = require("electron");

const CHANNELS = [
  "catalog:list", "catalog:categories", "catalog:get", "catalog:add",
  "catalog:update", "catalog:history", "catalog:bulkUpdate",
  "clients:list", "clients:save", "clients:delete",
  "projects:save", "projects:list", "projects:get", "projects:delete",
  "projects:importLegacy", "db:exportJson", "project:exportExcel",
  "settings:get", "settings:save",
  "db:openDataFolder", "db:scanLegacy", "db:importFromPath", "db:importJsonFile"
];

const api = {};
CHANNELS.forEach(ch => {
  const name = ch.replace(/:/g, "_");
  api[name] = (payload) => ipcRenderer.invoke(ch, payload);
});

contextBridge.exposeInMainWorld("fireApi", api);
