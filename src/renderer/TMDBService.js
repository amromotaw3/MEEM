class TMDBService {
  constructor() {
    if (TMDBService.instance) {
      return TMDBService.instance;
    }
    this.BASE_IMAGE_URL = 'https://image.tmdb.org/t/p';
    this.FALLBACK_IMAGE = 'assets/no-image.png'; // Make sure this exists or use a base64/CSS placeholder
    this.apiKey = null;
    TMDBService.instance = this;
  }

  async init() {
    if (!this.apiKey) {
      this.apiKey = await window.api.invoke('get-tmdb-key-masked');
    }
  }

  getPosterUrl(path, size = 'medium') {
    if (!path) return this.FALLBACK_IMAGE;
    const sizeMap = {
      small: 'w185',
      medium: 'w342',
      original: 'original'
    };
    return `${this.BASE_IMAGE_URL}/${sizeMap[size] || 'w342'}${path}`;
  }

  getBackdropUrl(path, size = 'large') {
    if (!path) return this.FALLBACK_IMAGE;
    const sizeMap = {
      medium: 'w780',
      large: 'w1280',
      original: 'original'
    };
    return `${this.BASE_IMAGE_URL}/${sizeMap[size] || 'w1280'}${path}`;
  }

  async getEpisodeImage(tvId, seasonNum, episodeNum) {
    const cache = window.appData?.tmdbCache?.[tvId]?.seasons?.[seasonNum];
    if (cache && cache[episodeNum]?.still_path) {
      return `${this.BASE_IMAGE_URL}/w300${cache[episodeNum].still_path}`;
    }
    try {
      const data = await window.api.invoke('tmdb-season-details', tvId, seasonNum);
      const ep = (data?.episodes || []).find(e => e.episode_number == episodeNum);
      return ep?.still_path ? `${this.BASE_IMAGE_URL}/w300${ep.still_path}` : this.FALLBACK_IMAGE;
    } catch (e) {
      console.error('TMDBService episode image fetch failed:', e);
      return this.FALLBACK_IMAGE;
    }
  }

  async getShowMetadata(tvId) {
    try {
      return await window.api.invoke('tmdb-details', 'tv', tvId);
    } catch (e) {
      console.error('TMDBService metadata fetch failed:', e);
      return null;
    }
  }
}

const tmdbService = new TMDBService();

// Reusable Custom Element (Web Component) replacing <TMDBImage />
class TMDBImageElement extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-block;
          position: relative;
          overflow: hidden;
          border-radius: inherit;
          background: rgba(255, 255, 255, 0.05); /* Shimmer base */
        }
        img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
          opacity: 0;
          transition: opacity 0.3s ease;
          border-radius: inherit;
        }
        img.loaded {
          opacity: 1;
        }
        .shimmer {
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent);
          background-size: 200% 100%;
          animation: shimmer 1.5s infinite linear;
          pointer-events: none;
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        :host([loaded]) .shimmer {
          display: none;
        }
      </style>
      <div class="shimmer"></div>
      <img alt="" />
    `;
  }

  static get observedAttributes() {
    return ['path', 'type', 'size', 'alt'];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue) {
      this.loadImage();
    }
  }

  connectedCallback() {
    this.loadImage();
  }

  loadImage() {
    const path = this.getAttribute('path');
    if (!path) return;

    const type = this.getAttribute('type') || 'poster';
    const size = this.getAttribute('size') || 'medium';
    
    let url = tmdbService.FALLBACK_IMAGE;
    
    if (path.startsWith('http') || path.startsWith('file://')) {
      url = path;
    } else {
      if (type === 'poster') url = tmdbService.getPosterUrl(path, size);
      else if (type === 'backdrop') url = tmdbService.getBackdropUrl(path, size);
      else if (type === 'still') url = `${tmdbService.BASE_IMAGE_URL}/w300${path}`;
    }

    const img = this.shadowRoot.querySelector('img');
    img.src = url;
    if (this.getAttribute('alt')) img.alt = this.getAttribute('alt');

    img.onload = () => {
      img.classList.add('loaded');
      this.setAttribute('loaded', '');
    };
    img.onerror = () => {
      img.style.display = 'none'; // Fallback to grey background
    };
  }
}

customElements.define('tmdb-image', TMDBImageElement);

window.tmdbService = tmdbService;
window.TMDBImageElement = TMDBImageElement;
