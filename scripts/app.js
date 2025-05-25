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

// 1. Handle Image Upload
async function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  originalFile = file;
  analyzeBtn.disabled = false;

  // Preview image
  imagePreview.src = URL.createObjectURL(file);
  originalArrayBuffer = await file.arrayBuffer();
}

// 2. Analyze Image
async function analyzeImage() {
  if (!originalFile) return;
  showLoading(true);

  try {
    // Extract existing metadata
    const metadata = await exifr.parse(originalArrayBuffer, { iptc: true });
    
    // Generate new caption/keywords
    const generated = await generateMetadata(originalFile, {
      caption: metadata?.caption || '',
      keywords: metadata?.keywords || []
    });
    
    // Display results
    displayMetadata(generated);
    showLoading(false);
    results.classList.remove('hidden');
  } catch (error) {
    console.error('Error:', error);
    alert(`Error: ${error.message}`);
    showLoading(false);
  }
}

// 3. Generate Metadata via API
async function generateMetadata(file, existingData) {
  let apiKey = localStorage.getItem('OPENROUTER_API_KEY');
  if (!apiKey) {
    apiKey = window.prompt('Enter OpenRouter API key:');
    if (!apiKey) throw new Error('API key required');
    localStorage.setItem('OPENROUTER_API_KEY', apiKey);
  }

  const imageBase64 = await fileToBase64(file);
  
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.href,
      'X-Title': 'Image Captioner'
    },
    body: JSON.stringify({
      model: "deepseek/deepseek-chat:free",
      messages: [{
        role: "user",
        content: [
          { 
            type: "image_url", 
            image_url: `data:image/jpeg;base64,${imageBase64}` 
          },
          { 
            type: "text", 
            text: `Generate AP-style caption and 20 keywords. Existing caption: "${existingData.caption}"` 
          }
        ]
      }],
      temperature: 0.3
    })
  });

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('OPENROUTER_API_KEY');
      throw new Error('Invalid API key. Please refresh and try again.');
    }
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return parseApiResponse(data.choices[0]?.message?.content);
}

// 4. Save with IPTC Metadata
async function saveAndDownload() {
  showLoading(true);
  
  try {
    const base64 = await fileToBase64(originalFile);
    const exifObj = piexif.load(base64);
    
    // Update IPTC metadata
    exifObj['0th'][piexif.ImageIFD.XPSubject] = stringToBytes(captionInput.value);
    exifObj['iptc'] = exifObj['iptc'] || {};
    exifObj['iptc'][piexif.IptcIFD.Caption] = captionInput.value;
    
    // Add keywords (max 64 chars each)
    currentKeywords.slice(0, 20).forEach((kw, i) => {
      exifObj['iptc'][piexif.IptcIFD.Keywords + i] = kw.substring(0, 64);
    });

    const exifBytes = piexif.dump(exifObj);
    const newImage = piexif.insert(exifBytes, base64);
    
    downloadFile(newImage, `captioned_${originalFile.name}`);
  } catch (error) {
    alert(`Error saving: ${error.message}`);
  } finally {
    showLoading(false);
  }
}

// Helper Functions
function showLoading(show) {
  loading.classList.toggle('hidden', !show);
  [analyzeBtn, saveBtn].forEach(btn => btn.disabled = show);
}

async function fileToBase64(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result.split(',')[1]);
    reader.readAsDataURL(file);
  });
}

function downloadFile(base64, filename) {
  const link = document.createElement('a');
  link.href = `data:image/jpeg;base64,${base64}`;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function stringToBytes(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    bytes.push(str.charCodeAt(i));
    bytes.push(0); // UTF-16
  }
  return bytes;
}

function parseApiResponse(content) {
  const caption = content.match(/CAPTION:\s*(.+?)(?:\s*\||$)/i)?.[1]?.trim() || 'No caption';
  const keywords = content.match(/KEYWORDS:\s*(.+)/i)?.[1]?.split(/\s*,\s*/) || [];
  return { caption, keywords };
}

function displayMetadata(data) {
  captionInput.value = data.caption;
  currentKeywords = [...new Set(data.keywords)].slice(0, 20);
  renderKeywords();
}

function renderKeywords() {
  keywordsContainer.innerHTML = '';
  currentKeywords.forEach((kw, i) => {
    const tag = document.createElement('div');
    tag.className = 'keyword-tag';
    tag.innerHTML = `${kw} <span class="delete-keyword" data-index="${i}">×</span>`;
    tag.querySelector('.delete-keyword').addEventListener('click', (e) => {
      currentKeywords.splice(parseInt(e.target.dataset.index), 1);
      renderKeywords();
    });
    keywordsContainer.appendChild(tag);
  });
}

function addKeyword() {
  const kw = newKeyword.value.trim();
  if (kw && !currentKeywords.includes(kw)) {
    currentKeywords.push(kw);
    newKeyword.value = '';
    renderKeywords();
  }
}