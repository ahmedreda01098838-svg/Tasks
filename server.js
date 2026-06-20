const express = require('express');
const path = require('path');
const app = express();

// تشغيل الملفات الثابتة في المجلد الحالي
app.use(express.static(path.join(__dirname)));

// تقديم صفحة الواجهة الرئيسية
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// منفذ السيرفر الديناميكي للمواقف السحابية أو المحلي 3000
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🚀 السيرفر شغال بنجاح: http://localhost:${PORT}`);
});