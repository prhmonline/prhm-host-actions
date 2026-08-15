const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const pub=path.join(__dirname,'company-os-dashboard','public');
function read(n){return fs.readFileSync(path.join(pub,n),'utf8')}
test('dashboard HTML is Persian RTL and contains all daily work views',()=>{
 const h=read('index.html');
 assert.match(h,/<html[^>]+lang="fa"[^>]+dir="rtl"/);
 for(const x of ['وضعیت امروز','فرصت‌های جذب پروژه','اقتصاد و تصمیم‌ها','مرکز تأیید و عملیات سیستمی','گزارش‌ها و سلامت'])assert.match(h,new RegExp(x));
 for(const id of ['view-overview','view-opportunities','view-decisions','view-host-actions','view-reports'])assert.match(h,new RegExp(`id="${id}"`));
 assert.match(h,/اجرای زنده P0/);assert.match(h,/ارسال خودکار پیشنهاد/);assert.match(h,/ارسال خودکار قیمت/);
 assert.match(h,/aria-live/);assert.match(h,/loading/);assert.match(h,/empty-state/);assert.match(h,/error-state/);
});
test('dashboard CSS has deliberate design tokens and responsive layouts',()=>{
 const c=read('styles.css');
 for(const x of ['--bg','--surface','--primary','--success','--warning','--danger','--text','--radius'])assert.match(c,new RegExp(x.replace('--','\\-\\-')));
 assert.match(c,/@media\s*\(max-width:\s*980px\)/);assert.match(c,/@media\s*\(max-width:\s*720px\)/);
 assert.match(c,/grid-template-columns/);assert.match(c,/focus-visible/);
});
test('dashboard JS consumes only snapshot GET API and supports refresh/filter/navigation',()=>{
 const j=read('app.js');
 assert.match(j,/\/company-os\/api\/snapshot/);
 assert.match(j,/fetch\(/);assert.doesNotMatch(j,/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)/i);
 assert.match(j,/setInterval/);assert.match(j,/Intl\.NumberFormat\('fa-IR'/);assert.match(j,/data-view/);
 assert.match(j,/renderOpportunities/);assert.match(j,/renderDecisions/);assert.match(j,/renderHostActions/);assert.match(j,/renderReports/);
});
