let words = JSON.parse(localStorage.getItem('lingo_words') || '[]');
    let currentPdf = null;
    let currentBookId = null;
    let lastSelection = { en: '', cs: '' };
    let db;
    let pageObserver; 
    let globalZoom = 1.0; 
    let pendingTranslationText = ""; 
    let langFrom = 'en';
    let langTo = 'cs';

    function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('LingoDB', 1);
            request.onerror = (e) => reject("Chyba databáze");
            request.onsuccess = (e) => { db = e.target.result; resolve(db); };
            request.onupgradeneeded = (e) => {
                const database = e.target.result;
                if (!database.objectStoreNames.contains('books')) {
                    database.createObjectStore('books', { keyPath: 'id' });
                }
            };
        });
    }

    initDB().then(() => renderLibrary());

    function toggleTheme() {
        const doc = document.documentElement;
        doc.setAttribute('data-theme', doc.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    }

    function forceUpdate() {
        if(confirm("Chcete stáhnout nejnovější verzi aplikace z GitHubu? (Tvoje knihy a slovíčka zůstanou v bezpečí)")) {
            window.location.href = window.location.pathname + '?v=' + new Date().getTime();
        }
    }

    function swapLanguages() {
        if (langFrom === 'en') {
            langFrom = 'cs';
            langTo = 'en';
            document.getElementById('lang-from').innerText = 'Čeština';
            document.getElementById('lang-to').innerText = 'Angličtina';
        } else {
            langFrom = 'en';
            langTo = 'cs';
            document.getElementById('lang-from').innerText = 'Angličtina';
            document.getElementById('lang-to').innerText = 'Čeština';
        }
    }

    async function translate(text, sl = 'auto', tl = 'cs') {
        if (!text) return "";
        try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
            const res = await fetch(url);
            const data = await res.json();
            
            let translatedText = "";
            data[0].forEach(item => {
                translatedText += item[0];
            });
            return translatedText;
        } catch (e) { 
            console.error("Chyba překladu:", e);
            return "Chyba překladu. Zkontrolujte připojení."; 
        }
    }

    const fileInput = document.getElementById('file-upload');
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        document.getElementById('book-list').innerHTML = "Ukládám knihu do iPhonu...";
        
        const arrayBuffer = await file.arrayBuffer();
        const bookName = file.name.replace('.pdf', '');
        
        let startPage = 1;
        const savedProgress = JSON.parse(localStorage.getItem('lingo_book_progress') || '[]');
        const match = savedProgress.find(p => p.name === bookName);
        if (match) startPage = match.currentPage;

        const book = {
            id: file.name,
            name: bookName,
            data: arrayBuffer,
            currentPage: startPage
        };

        const tx = db.transaction('books', 'readwrite');
        tx.objectStore('books').put(book);
        tx.oncomplete = () => renderLibrary();
    });

    function renderLibrary() {
        if(!db) return;
        const tx = db.transaction('books', 'readonly');
        const req = tx.objectStore('books').getAll();
        req.onsuccess = () => {
            const books = req.result;
            const list = document.getElementById('book-list');
            if(books.length === 0) {
                list.innerHTML = "<p style='color:gray; text-align:center;'>Zatím tu nemáte žádné knihy.</p>";
                return;
            }
            list.innerHTML = books.map(b => `
                <div class="book-item" style="max-width: 500px; margin-left: auto; margin-right: auto;">
                    <div onclick="openBook('${b.id}')" style="flex:1; cursor:pointer;">
                        <b>${b.name.substring(0,25)}...</b><br>
                        <small style="color:gray;">Rozečteno: Strana ${b.currentPage || 1}</small>
                    </div>
                    <button onclick="deleteBook('${b.id}')" style="background:none; border:none; font-size:22px; color:#ff3b30; padding:10px;">🗑️</button>
                </div>
            `).reverse().join('');
        };
    }

    function deleteBook(id) {
        if(confirm("Opravdu smazat tuto knihu?")) {
            const tx = db.transaction('books', 'readwrite');
            tx.objectStore('books').delete(id);
            tx.oncomplete = () => {
                if(currentBookId === id) {
                    currentBookId = null;
                    currentPdf = null;
                    document.getElementById('pdf-view').style.display = 'none';
                    document.getElementById('pagination').style.display = 'none';
                    document.getElementById('zoom-controls').style.display = 'none';
                }
                renderLibrary();
            };
        }
    }

    function openBook(id) {
        const tx = db.transaction('books', 'readonly');
        const req = tx.objectStore('books').get(id);
        req.onsuccess = async () => {
            const book = req.result;
            if(!book) return;
            
            currentBookId = book.id;
            globalZoom = 1.0; 
            document.getElementById('zoom-val').innerText = '100%';
            currentPdf = await pdfjsLib.getDocument({ data: new Uint8Array(book.data) }).promise;
            
            document.getElementById('pdf-view').style.display = 'flex';
            document.getElementById('pagination').style.display = 'block';
            document.getElementById('zoom-controls').style.display = 'flex';
            document.getElementById('no-book-msg').style.display = 'none';
            
            document.getElementById('nav-read').click();
            
            initScrollReader(book.currentPage || 1);
        };
    }

    function updateBookProgress(page) {
        if(!currentBookId || !db) return;
        const tx = db.transaction('books', 'readwrite');
        const store = tx.objectStore('books');
        const req = store.get(currentBookId);
        req.onsuccess = () => {
            const book = req.result;
            if(book) {
                book.currentPage = page;
                store.put(book);
            }
        };
    }

    function changeZoom(delta) {
        let newZoom = globalZoom + delta;
        if (newZoom < 0.5) newZoom = 0.5;
        if (newZoom > 3.0) newZoom = 3.0;
        
        newZoom = Math.round(newZoom * 10) / 10;
        
        if (newZoom === globalZoom) return;
        
        globalZoom = newZoom;
        document.getElementById('zoom-val').innerText = Math.round(globalZoom * 100) + '%';
        
        let currentPage = parseInt(document.getElementById('page-info').innerText.split(' / ')[0]) || 1;
        initScrollReader(currentPage); 
    }

    function initScrollReader(startPage) {
        const container = document.getElementById('pdf-view');
        container.innerHTML = '';
        
        if (pageObserver) pageObserver.disconnect();
        
        pageObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const wrapper = entry.target;
                    const num = parseInt(wrapper.dataset.page);
                    
                    if (wrapper.dataset.loaded === 'false') {
                        wrapper.dataset.loaded = 'true';
                        renderSinglePage(num, wrapper);
                    }
                    
                    document.getElementById('page-info').innerText = `${num} / ${currentPdf.numPages}`;
                    updateBookProgress(num);
                }
            });
        }, { rootMargin: '300px 0px' });
        
        for (let num = 1; num <= currentPdf.numPages; num++) {
            const wrapper = document.createElement('div');
            wrapper.className = 'pdf-page-wrapper';
            wrapper.id = 'page-wrapper-' + num;
            wrapper.style.minHeight = window.innerHeight + 'px'; 
            wrapper.dataset.page = num;
            wrapper.dataset.loaded = 'false';
            
            container.appendChild(wrapper);
            pageObserver.observe(wrapper);
        }

        setTimeout(() => {
            const targetPage = document.getElementById('page-wrapper-' + startPage);
            if (targetPage) targetPage.scrollIntoView();
        }, 100);
    }

    async function renderSinglePage(num, wrapper) {
        const page = await currentPdf.getPage(num);
        const canvas = document.createElement('canvas');
        const textLayerDiv = document.createElement('div');
        textLayerDiv.className = 'textLayer';
        
        wrapper.appendChild(canvas);
        wrapper.appendChild(textLayerDiv);
        
        const unscaledViewport = page.getViewport({ scale: 1 });
        const baseScale = window.innerWidth / unscaledViewport.width;
        const viewport = page.getViewport({ scale: baseScale * globalZoom });

        const outputScale = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = Math.floor(viewport.width) + "px";
        canvas.style.height = Math.floor(viewport.height) + "px";

        wrapper.style.width = Math.floor(viewport.width) + "px";
        wrapper.style.minHeight = 'auto';
        wrapper.style.height = Math.floor(viewport.height) + "px";

        const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
        const context = canvas.getContext('2d');
        
        await page.render({ canvasContext: context, transform: transform, viewport: viewport }).promise;

        textLayerDiv.style.width = viewport.width + 'px';
        textLayerDiv.style.height = viewport.height + 'px';
        textLayerDiv.style.setProperty('--scale-factor', viewport.scale);
        
        const textContent = await page.getTextContent();
        pdfjsLib.renderTextLayer({ textContent: textContent, container: textLayerDiv, viewport: viewport, textDivs: [] });
    }

    document.addEventListener('selectionchange', () => {
        const sel = window.getSelection();
        const tooltip = document.getElementById('translate-tooltip');
        
        if (!sel.isCollapsed && sel.toString().trim().length > 1 && document.getElementById('tab-reader').classList.contains('active')) {
            pendingTranslationText = sel.toString().trim();
            const range = sel.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            
            tooltip.style.display = 'block';
            tooltip.style.left = (rect.left + rect.width / 2) + 'px';
            
            let topPos = rect.top - 50;
            if (topPos < 50) topPos = rect.bottom + 10;
            tooltip.style.top = topPos + 'px';
            
        } else {
            tooltip.style.display = 'none';
            pendingTranslationText = "";
        }
    });

    window.addEventListener('scroll', () => {
        document.getElementById('translate-tooltip').style.display = 'none';
    }, true);

    async function executeTranslation() {
        if (!pendingTranslationText) return;
        
        document.getElementById('translate-tooltip').style.display = 'none';
        
        const selText = pendingTranslationText;
        document.getElementById('pop-en').innerText = selText;
        document.getElementById('pop-cs').innerText = "Překládám...";
        document.getElementById('popover').style.display = 'block';
        
        const trans = await translate(selText, 'auto', 'cs');
        lastSelection = { en: selText, cs: trans };
        document.getElementById('pop-cs').innerText = trans;
    }

    function saveWord() {
        if(!lastSelection.en) return;

        const isDuplicate = words.some(w => w.en.toLowerCase() === lastSelection.en.toLowerCase());
        
        if (isDuplicate) {
            alert("Toto slovo nebo větu už ve slovníčku máš!");
            closePop();
            return;
        }

        words.push({ ...lastSelection, id: Date.now(), known: false });
        localStorage.setItem('lingo_words', JSON.stringify(words));
        closePop();

        if (document.getElementById('tab-words').classList.contains('active')) {
            renderWords();
        }
    }
    
    function closePop() { 
        document.getElementById('popover').style.display = 'none'; 
        window.getSelection().removeAllRanges(); 
    }

    function exportBackup() {
        const tx = db.transaction('books', 'readonly');
        const req = tx.objectStore('books').getAll();
        
        req.onsuccess = () => {
            const books = req.result;
            const bookProgress = books.map(b => ({ id: b.id, name: b.name, currentPage: b.currentPage }));
            
            const backupData = {
                words: words,
                bookProgress: bookProgress
            };

            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData));
            const downloadNode = document.createElement('a');
            downloadNode.setAttribute("href", dataStr);
            downloadNode.setAttribute("download", "lingo_kompletni_zaloha.json");
            document.body.appendChild(downloadNode);
            downloadNode.click();
            downloadNode.remove();
        };
    }

    function importBackup(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const importedData = JSON.parse(e.target.result);
                if (importedData.words) {
                    words = importedData.words;
                    localStorage.setItem('lingo_words', JSON.stringify(words));
                    renderWords();
                } else if (Array.isArray(importedData)) { 
                    words = importedData;
                    localStorage.setItem('lingo_words', JSON.stringify(words));
                    renderWords();
                }
                
                if (importedData.bookProgress) {
                    localStorage.setItem('lingo_book_progress', JSON.stringify(importedData.bookProgress));
                    
                    if (db) {
                        const tx = db.transaction('books', 'readwrite');
                        const store = tx.objectStore('books');
                        importedData.bookProgress.forEach(backupBook => {
                            const getReq = store.get(backupBook.id);
                            getReq.onsuccess = () => {
                                if(getReq.result) {
                                    let b = getReq.result;
                                    b.currentPage = backupBook.currentPage;
                                    store.put(b);
                                }
                            };
                        });
                        tx.oncomplete = () => renderLibrary();
                    }
                }
                alert("Záloha byla úspěšně obnovena!");
            } catch (err) {
                alert("Chyba při čtení souboru. Zkontroluj, že jde o správnou zálohu.");
            }
        };
        reader.readAsText(file);
        event.target.value = ''; 
    }

    function deleteWord(id) {
        if(confirm("Opravdu smazat toto slovíčko?")) {
            words = words.filter(w => w.id !== id);
            localStorage.setItem('lingo_words', JSON.stringify(words));
            renderWords();
        }
    }

    function showTab(id, el) {
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
        document.getElementById('tab-' + id).classList.add('active');
        el.classList.add('active');
        
        if(id === 'reader') {
            if(!currentPdf) {
                document.getElementById('pdf-view').style.display = 'none';
                document.getElementById('pagination').style.display = 'none';
                document.getElementById('zoom-controls').style.display = 'none';
                document.getElementById('no-book-msg').style.display = 'block';
            } else {
                renderLibrary();
                document.getElementById('zoom-controls').style.display = 'flex';
            }
        } else {
            document.getElementById('zoom-controls').style.display = 'none';
            document.getElementById('translate-tooltip').style.display = 'none';
            if (id === 'library') renderLibrary();
            else if (id === 'words') renderWords();
            else if (id === 'cards') startCards();
        }
    }

    function renderWords() {
        const list = document.getElementById('word-list');
        if(words.length === 0) {
            list.innerHTML = "<p style='color:gray; text-align:center;'>Slovníček je zatím prázdný.</p>";
            return;
        }
        list.innerHTML = words.map(w => `
            <div class="word-item" style="max-width: 500px; margin-left: auto; margin-right: auto;">
                <div class="word-item-text">
                    <b>${w.en}</b><span style="opacity:0.8; margin-top:5px;">${w.cs}</span>
                </div>
                <button onclick="deleteWord(${w.id})" style="background:none; border:none; font-size:20px; color:#ff3b30; padding:10px; cursor:pointer;">🗑️</button>
            </div>`).reverse().join('');
    }

    let cardIdx = 0, cardFlipped = false;
    
    function startCards() { 
        if (words.length > 0) {
            nextRandomCard();
        } else {
            updateCard(); 
        }
    }

    function getNextRandomWord() {
        if (words.length <= 1) return 0;

        let unknownIndices = [];
        let knownIndices = [];
        
        words.forEach((w, i) => {
            if (w.known) knownIndices.push(i);
            else unknownIndices.push(i);
        });

        let pool = [];
        if (unknownIndices.length > 0) {
            let filtered = unknownIndices.filter(i => i !== cardIdx);
            pool = filtered.length > 0 ? filtered : unknownIndices;
        } else {
            let filtered = knownIndices.filter(i => i !== cardIdx);
            pool = filtered.length > 0 ? filtered : knownIndices;
        }

        return pool[Math.floor(Math.random() * pool.length)];
    }
    
    function updateCard() {
        const c = document.getElementById('flashcard');
        const counter = document.getElementById('card-counter');
        
        if (!words.length) { 
            c.innerText = "Žádná slovíčka"; 
            counter.innerText = "Slov celkem: 0";
            return; 
        }
        
        c.innerText = cardFlipped ? words[cardIdx].cs : words[cardIdx].en;
        c.style.color = cardFlipped ? "var(--p)" : "var(--text)";
        c.style.fontSize = words[cardIdx].en.length > 30 ? "18px" : "24px";
        
        let knownCount = words.filter(w => w.known).length;
        let unknownCount = words.length - knownCount;
        counter.innerText = `K naučení: ${unknownCount} | Umím: ${knownCount}`;
    }
    
    function flipCard() {
        if (!words.length) return;
        cardFlipped = !cardFlipped;
        updateCard();
    }

    function nextRandomCard() {
        if (!words.length) return;
        cardIdx = getNextRandomWord();
        cardFlipped = false;
        updateCard();
    }

    function markKnown() {
        if (!words.length) return;
        words[cardIdx].known = true;
        localStorage.setItem('lingo_words', JSON.stringify(words));
        nextRandomCard();
    }

    function markUnknown() {
        if (!words.length) return;
        words[cardIdx].known = false;
        localStorage.setItem('lingo_words', JSON.stringify(words));
        nextRandomCard();
    }

    async function manualTranslate() {
        const input = document.getElementById('manual-input');
        if(!input.value.trim()) return;
        
        const res = await translate(input.value, langFrom, langTo);
        
        const enText = langFrom === 'en' ? input.value : res;
        const csText = langFrom === 'en' ? res : input.value;
        
        lastSelection = { en: enText, cs: csText };
        
        document.getElementById('manual-result').innerHTML = `
            <div class="card" style="margin-top:10px; min-height:100px; font-size:16px; text-align:left;">
                <b>${input.value}</b><br><br>${res}<br>
                <button class="btn-action" style="margin-top: 15px;" onclick="saveWord()">Uložit do slovníčku</button>
            </div>`;
    }