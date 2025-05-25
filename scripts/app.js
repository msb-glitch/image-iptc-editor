// DOM Elements
const imageInput = document.getElementById('imageInput');
const analyzeBtn = document.getElementById('analyzeBtn');
const loading = document.getElementById('loading');
const results = document.getElementById('results');
const imagePreview = document.getElementById('imagePreview');
const captionInput = document.getElementById('captionInput');
const keywordsContainer = document.getElementById('keywordsContainer');
const newKeyword = document.getElementById('newKeyword');
const addKeywordBtn = document.getElementById('addKeywordBtn');
const saveBtn = document.getElementById('saveBtn');

// State
let originalFile = null;
let originalArrayBuffer = null;
let currentKeywords = [];

// Event Listeners
imageInput.addEventListener('change', handleImageUpload);
analyzeBtn.addEventListener('click', analyzeImage);
addKeywordBtn.addEventListener('click', addKeyword);
saveBtn.addEventListener('click', saveAndDownload);

// Handle image upload
async function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    originalFile = file;
    analyzeBtn.disabled = false;

    // Preview image
    imagePreview.src = URL.createObjectURL(file);
    
    // Read file as ArrayBuffer for metadata
    originalArrayBuffer = await file.arrayBuffer();
}

// Analyze image and extract metadata
async function analyzeImage() {
    if (!originalFile) return;

    showLoading(true);

    try {
        // 1. Extract existing IPTC data
        const iptcData = await extractIptcData(originalArrayBuffer);
        
        // 2. Generate new caption and keywords
        const generatedData = await generateMetadata(originalFile, iptcData);
        
        // 3. Display results
        displayMetadata(iptcData, generatedData);
        
        showLoading(false);
        results.classList.remove('hidden');
    } catch (error) {
        console.error('Error:', error);
        alert(`Error: ${error.message}`);
        showLoading(false);
    }
}

// 1. Extract IPTC Data
async function extractIptcData(arrayBuffer) {
    const metadata = await exifr.parse(arrayBuffer, { iptc: true });
    
    return {
        caption: metadata?.iptc?.Caption || '',
        keywords: metadata?.iptc?.Keywords || []
    };
}

// 2. Generate New Metadata
async function generateMetadata(file, existingData) {
    const apiKey = localStorage.getItem('OPENROUTER_API_KEY') || 
                  prompt('Enter your OpenRouter API key (will be saved locally):');
    
    if (!apiKey) throw new Error('API key required');
    localStorage.setItem('OPENROUTER_API_KEY', apiKey);

    const imageBase64 = await fileToBase64(file);
    
    const prompt = `Analyze this image and:
1. Write a concise AP Style caption (15 words max)
2. Generate 20+ relevant keywords
3. Consider existing caption: "${existingData.caption}"
Format: CAPTION: [caption] | KEYWORDS: [comma-separated keywords]`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': window.location.href,
            'X-Title': 'IPTC Editor'
        },
        body: JSON.stringify({
            model: "deepseek/deepseek-chat:free",
            messages: [{
                role: "user",
                content: [
                    { type: "image_url", image_url: `data:image/jpeg;base64,${imageBase64}` },
                    { type: "text", text: prompt }
                ]
            }],
            temperature: 0.3
        })
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const data = await response.json();
    return parseApiResponse(data.choices[0]?.message?.content);
}

function parseApiResponse(content) {
    const captionMatch = content.match(/CAPTION:\s*(.+?)\s*(\||$)/i);
    const keywordsMatch = content.match(/KEYWORDS:\s*(.+?)\s*$/i);
    
    return {
        caption: captionMatch?.[1]?.trim() || 'No caption generated',
        keywords: keywordsMatch?.[1]?.split(',').map(k => k.trim()).filter(k => k) || []
    };
}

// 3. Display Metadata
function displayMetadata(existingData, generatedData) {
    // Combine existing and generated captions
    captionInput.value = generatedData.caption || existingData.caption;
    
    // Combine and deduplicate keywords
    currentKeywords = [...new Set([
        ...existingData.keywords,
        ...generatedData.keywords
    ])].slice(0, 25); // Limit to 25 keywords
    
    renderKeywords();
}

function renderKeywords() {
    keywordsContainer.innerHTML = '';
    currentKeywords.forEach((keyword, index) => {
        const tag = document.createElement('div');
        tag.className = 'keyword-tag';
        tag.innerHTML = `
            ${keyword}
            <span class="delete-keyword" data-index="${index}">×</span>
        `;
        keywordsContainer.appendChild(tag);
    });

    // Add delete handlers
    document.querySelectorAll('.delete-keyword').forEach(btn => {
        btn.addEventListener('click', (e) => {
            currentKeywords.splice(parseInt(e.target.dataset.index), 1);
            renderKeywords();
        });
    });
}

function addKeyword() {
    const keyword = newKeyword.value.trim();
    if (keyword && !currentKeywords.includes(keyword)) {
        currentKeywords.push(keyword);
        renderKeywords();
        newKeyword.value = '';
    }
}

// 4. Save New Metadata and Download
async function saveAndDownload() {
    if (!originalArrayBuffer) return;

    showLoading(true);

    try {
        // Convert ArrayBuffer to base64
        const base64 = arrayBufferToBase64(originalArrayBuffer);
        
        // Load existing EXIF data
        const exifObj = piexif.load(base64);
        
        // Update IPTC data
        if (!exifObj['0th']) exifObj['0th'] = {};
        if (!exifObj['iptc']) exifObj['iptc'] = {};
        
        // Set caption (XPSubject in EXIF, Caption in IPTC)
        exifObj['0th'][piexif.ImageIFD.XPSubject] = stringToBytes(captionInput.value);
        exifObj['iptc'][piexif.IptcIFD.Caption] = captionInput.value;
        
        // Set keywords (split into multiple IPTC tags if needed)
        const maxKeywordsPerTag = 16;
        for (let i = 0; i < currentKeywords.length; i += maxKeywordsPerTag) {
            const chunk = currentKeywords.slice(i, i + maxKeywordsPerTag);
            exifObj['iptc'][piexif.IptcIFD.Keywords + i/maxKeywordsPerTag] = chunk.join(',');
        }
        
        // Insert updated metadata
        const exifBytes = piexif.dump(exifObj);
        const newImageData = piexif.insert(exifBytes, base64);
        
        // Create download
        const byteString = atob(newImageData);
        const byteArray = new Uint8Array(byteString.length);
        for (let i = 0; i < byteString.length; i++) {
            byteArray[i] = byteString.charCodeAt(i);
        }
        
        const blob = new Blob([byteArray], { type: 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `iptc_edited_${originalFile.name}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
    } catch (error) {
        console.error('Error saving metadata:', error);
        alert(`Error saving: ${error.message}`);
    } finally {
        showLoading(false);
    }
}

// Helper Functions
function showLoading(show) {
    loading.classList.toggle('hidden', !show);
    analyzeBtn.disabled = show;
    saveBtn.disabled = show;
}

async function fileToBase64(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result.split(',')[1]);
        reader.readAsDataURL(file);
    });
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function stringToBytes(str) {
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
        bytes.push(str.charCodeAt(i));
        bytes.push(0); // UTF-16 null byte
    }
    return bytes;
}