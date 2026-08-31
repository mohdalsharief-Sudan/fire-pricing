// src/import_cad.js
const { dialog, BrowserWindow } = require('electron');
const fs = require('fs');

async function importFromCAD(event, db) {
    console.log('[ImportCAD] 1. بدء الاستيراد');
    
    const win = BrowserWindow.fromWebContents(event.sender);
    
    const res = await dialog.showOpenDialog(win, {
        title: 'استيراد من Fire-CAD-Analyzer',
        filters: [{ name: 'Fire-CAD Export', extensions: ['json'] }],
        properties: ['openFile']
    });
    
    if (res.canceled || !res.filePaths.length) {
        return { canceled: true };
    }
    
    try {
        const filePath = res.filePaths[0];
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);
        
        // بناء items
        const items = [];
        
        (data.materials || []).forEach(m => {
            items.push({
                kind: 'material',
                name: m.name,
                qty: m.qty || 0,
                unit: m.unit || '',
                unit_cost: m.unitCost || 0,
            });
        });
        
        (data.equipment || []).forEach(e => {
            items.push({
                kind: 'equipment',
                name: e.name,
                qty: e.qty || 1,
                unit: 'وحدة',
                supply_cost: e.supplyCost || 0,
                install_cost: e.installCost || 0,
            });
        });
        
        (data.labor || []).forEach(l => {
            items.push({
                kind: 'labor',
                name: l.name,
                workers: l.workers || 1,
                days: l.days || 1,
                daily_cost: l.dailyCost || 0,
                qty: 1,
                unit: 'بند',
            });
        });
        
        (data.services || []).forEach(s => {
            items.push({
                kind: 'service',
                name: s.name,
                service_type: s.type || 'amount',
                service_value: s.value || 0,
                qty: 1,
                unit: 'بند',
            });
        });
        
        // بناء المشروع - بدون quoteNo (سيُنشأ تلقائياً)
        const project = {
            name: data.name || 'مشروع مستورد',
            date: data.date || new Date().toISOString().slice(0, 10),
            currency: 'SAR',
            vat: 15,
            validity: 30,
            margins: {},
            status: 'draft',
            total: (data.totals && data.totals.grandTotal) || 0,
            notes: 'مستورد من Fire-CAD-Analyzer',
            items: items,
        };
        
        console.log('[ImportCAD] حفظ المشروع:', project.name, '- items:', items.length);
        
        const saved = db.saveProject(project);
        console.log('[ImportCAD] تم الحفظ:', saved);
        
        return {
            canceled: false,
            imported: true,
            project: { id: saved.id, name: project.name, quoteNo: saved.quoteNo },
        };
        
    } catch (err) {
        console.error('[ImportCAD] خطأ:', err.message);
        return { canceled: false, imported: false, error: err.message };
    }
}

module.exports = { importFromCAD };