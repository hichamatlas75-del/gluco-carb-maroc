/**
 * ImageCropper : Outil interactif de recadrage et rotation avant analyse IA
 * - Supporte le tactile (mobile) et la souris (desktop) via PointerEvents
 * - Rotation 90° dans le sens horaire
 * - Ratios prédéfinis (Plein format, 1:1, 4:3)
 * - Rendu haute définition sur Canvas avec masque sombre
 */

export const ImageCropper = {
  modalEl: null,
  workspaceEl: null,
  stageEl: null,
  canvasEl: null,
  cropBoxEl: null,

  rawImage: null,
  rawSource: null,
  rotation: 0, // 0, 90, 180, 270
  onConfirmCallback: null,
  onCancelCallback: null,

  displayedWidth: 0,
  displayedHeight: 0,
  orientedWidth: 0,
  orientedHeight: 0,

  crop: { x: 0, y: 0, width: 0, height: 0 },
  activeDrag: null,
  isInitialized: false,

  init() {
    if (this.isInitialized) return;

    this.modalEl = document.getElementById('modalCropImage');
    this.workspaceEl = document.getElementById('cropWorkspace');
    this.stageEl = document.getElementById('cropStage');
    this.canvasEl = document.getElementById('cropDisplayCanvas');
    this.cropBoxEl = document.getElementById('cropBox');

    if (!this.modalEl || !this.workspaceEl || !this.stageEl || !this.canvasEl || !this.cropBoxEl) {
      return;
    }

    // Boutons de contrôle
    document.getElementById('btnRotateCrop')?.addEventListener('click', () => this.rotate());
    document.getElementById('btnResetCrop')?.addEventListener('click', () => this.setRatio('full'));
    document.getElementById('btnSquareCrop')?.addEventListener('click', () => this.setRatio('1:1'));
    document.getElementById('btn43Crop')?.addEventListener('click', () => this.setRatio('4:3'));

    document.getElementById('btnCancelCrop')?.addEventListener('click', () => this.cancel());
    document.getElementById('btnSkipCrop')?.addEventListener('click', () => this.skip());
    document.getElementById('btnConfirmCrop')?.addEventListener('click', () => this.confirm());

    // Gestion PointerEvents pour le déplacement et redimensionnement
    this.bindPointerEvents();

    // Redimensionnement de la fenêtre
    window.addEventListener('resize', () => {
      if (this.isOpen()) {
        this.renderStage();
      }
    });

    this.isInitialized = true;
  },

  isOpen() {
    return this.modalEl && !this.modalEl.classList.contains('hidden');
  },

  /**
   * Ouvre l'interface de recadrage avec l'image fournie
   * @param {File|Blob|string} source 
   * @param {Function} onConfirm (croppedDataUrl) => void
   * @param {Function} onCancel () => void
   */
  open(source, onConfirm, onCancel) {
    this.init();
    if (!this.modalEl) return;

    this.rawSource = source;
    this.onConfirmCallback = onConfirm;
    this.onCancelCallback = onCancel;
    this.rotation = 0;

    let srcUrl = null;
    let cleanupUrl = false;

    if (source instanceof Blob) {
      srcUrl = URL.createObjectURL(source);
      cleanupUrl = true;
    } else if (typeof source === 'string') {
      srcUrl = source;
    } else {
      console.error('Source d\'image invalide pour le recadrage');
      if (typeof onConfirm === 'function') onConfirm(source);
      return;
    }

    const img = new Image();
    img.onload = () => {
      if (cleanupUrl) URL.revokeObjectURL(srcUrl);
      this.rawImage = img;
      this.modalEl.classList.remove('hidden');
      this.modalEl.classList.add('flex');
      if (window.lucide) window.lucide.createIcons();

      // Laisser le navigateur calculer le layout de la modale avant de dimensionner le stage
      requestAnimationFrame(() => {
        this.renderStage(true);
      });
    };

    img.onerror = () => {
      if (cleanupUrl) URL.revokeObjectURL(srcUrl);
      console.warn('Impossible de charger l\'image dans le recadreur');
      // En cas d'erreur de chargement, basculer directement sur le flux normal
      if (typeof onConfirm === 'function') onConfirm(source);
    };

    img.src = srcUrl;
  },

  close() {
    if (this.modalEl) {
      this.modalEl.classList.add('hidden');
      this.modalEl.classList.remove('flex');
    }
    this.rawImage = null;
    this.rawSource = null;
    this.activeDrag = null;
  },

  cancel() {
    this.close();
    if (typeof this.onCancelCallback === 'function') {
      this.onCancelCallback();
    }
  },

  /**
   * Fait pivoter l'image de 90° dans le sens horaire
   */
  rotate() {
    this.rotation = (this.rotation + 90) % 360;
    this.renderStage(true);
  },

  /**
   * Calcule les dimensions d'affichage, trace l'image sur le canvas et repositionne la boîte de crop
   */
  renderStage(resetCrop = false) {
    if (!this.rawImage || !this.workspaceEl || !this.canvasEl || !this.stageEl) return;

    const natW = this.rawImage.naturalWidth || this.rawImage.width || 800;
    const natH = this.rawImage.naturalHeight || this.rawImage.height || 600;

    const isRotated = this.rotation === 90 || this.rotation === 270;
    this.orientedWidth = isRotated ? natH : natW;
    this.orientedHeight = isRotated ? natW : natH;

    // Espace utile dans le workspace (avec marge)
    const availW = Math.max(180, this.workspaceEl.clientWidth - 20);
    const availH = Math.max(180, this.workspaceEl.clientHeight - 20);

    const scale = Math.min(availW / this.orientedWidth, availH / this.orientedHeight, 1);
    this.displayedWidth = Math.max(120, Math.round(this.orientedWidth * scale));
    this.displayedHeight = Math.max(120, Math.round(this.orientedHeight * scale));

    this.canvasEl.width = this.displayedWidth;
    this.canvasEl.height = this.displayedHeight;

    this.stageEl.style.width = `${this.displayedWidth}px`;
    this.stageEl.style.height = `${this.displayedHeight}px`;

    // Dessin de l'image avec rotation
    const ctx = this.canvasEl.getContext('2d');
    ctx.clearRect(0, 0, this.displayedWidth, this.displayedHeight);
    ctx.save();
    ctx.translate(this.displayedWidth / 2, this.displayedHeight / 2);
    ctx.rotate((this.rotation * Math.PI) / 180);

    if (isRotated) {
      ctx.drawImage(this.rawImage, -this.displayedHeight / 2, -this.displayedWidth / 2, this.displayedHeight, this.displayedWidth);
    } else {
      ctx.drawImage(this.rawImage, -this.displayedWidth / 2, -this.displayedHeight / 2, this.displayedWidth, this.displayedHeight);
    }
    ctx.restore();

    if (resetCrop || this.crop.width === 0) {
      // Recadrage initial : 90% centré
      const mX = Math.round(this.displayedWidth * 0.05);
      const mY = Math.round(this.displayedHeight * 0.05);
      this.crop = {
        x: mX,
        y: mY,
        width: Math.max(40, this.displayedWidth - 2 * mX),
        height: Math.max(40, this.displayedHeight - 2 * mY)
      };
    } else {
      // Ajuster le crop actuel aux nouvelles bornes
      this.crop.x = Math.max(0, Math.min(this.crop.x, this.displayedWidth - 40));
      this.crop.y = Math.max(0, Math.min(this.crop.y, this.displayedHeight - 40));
      this.crop.width = Math.min(this.crop.width, this.displayedWidth - this.crop.x);
      this.crop.height = Math.min(this.crop.height, this.displayedHeight - this.crop.y);
    }

    this.updateCropBoxDOM();
  },

  updateCropBoxDOM() {
    if (!this.cropBoxEl) return;
    this.cropBoxEl.style.left = `${this.crop.x}px`;
    this.cropBoxEl.style.top = `${this.crop.y}px`;
    this.cropBoxEl.style.width = `${this.crop.width}px`;
    this.cropBoxEl.style.height = `${this.crop.height}px`;
  },

  setRatio(ratioType) {
    if (!this.displayedWidth || !this.displayedHeight) return;

    if (ratioType === 'full') {
      this.crop = {
        x: 0,
        y: 0,
        width: this.displayedWidth,
        height: this.displayedHeight
      };
      this.updateCropBoxDOM();
      return;
    }

    let targetRatio = 1; // largeur / hauteur
    if (ratioType === '4:3') targetRatio = 4 / 3;

    let w = this.displayedWidth * 0.88;
    let h = w / targetRatio;

    if (h > this.displayedHeight * 0.88) {
      h = this.displayedHeight * 0.88;
      w = h * targetRatio;
    }

    w = Math.round(Math.min(w, this.displayedWidth));
    h = Math.round(Math.min(h, this.displayedHeight));

    const x = Math.round((this.displayedWidth - w) / 2);
    const y = Math.round((this.displayedHeight - h) / 2);

    this.crop = { x, y, width: w, height: h };
    this.updateCropBoxDOM();
  },

  bindPointerEvents() {
    const minSize = 40;

    const onPointerDown = (e) => {
      const handleEl = e.target.closest('[data-handle]');
      const isBox = e.target.closest('#cropBox');

      if (!handleEl && !isBox) return;

      e.preventDefault();
      e.stopPropagation();

      const mode = handleEl ? handleEl.getAttribute('data-handle') : 'move';

      this.activeDrag = {
        pointerId: e.pointerId,
        mode,
        startX: e.clientX,
        startY: e.clientY,
        origCrop: { ...this.crop }
      };

      try {
        (handleEl || this.cropBoxEl).setPointerCapture(e.pointerId);
      } catch (_) {}
    };

    const onPointerMove = (e) => {
      if (!this.activeDrag || e.pointerId !== this.activeDrag.pointerId) return;

      e.preventDefault();
      const { mode, startX, startY, origCrop } = this.activeDrag;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      const maxW = this.displayedWidth;
      const maxH = this.displayedHeight;

      if (mode === 'move') {
        let newX = origCrop.x + dx;
        let newY = origCrop.y + dy;

        newX = Math.max(0, Math.min(newX, maxW - origCrop.width));
        newY = Math.max(0, Math.min(newY, maxH - origCrop.height));

        this.crop.x = Math.round(newX);
        this.crop.y = Math.round(newY);
      } else {
        // Redimensionnement via poignées
        let { x, y, width, height } = origCrop;

        // Est (droite)
        if (mode.includes('e')) {
          width = Math.min(maxW - x, Math.max(minSize, origCrop.width + dx));
        }
        // Ouest (gauche)
        if (mode.includes('w')) {
          const maxDx = origCrop.width - minSize;
          const clampedDx = Math.min(maxDx, Math.max(-origCrop.x, dx));
          x = origCrop.x + clampedDx;
          width = origCrop.width - clampedDx;
        }
        // Sud (bas)
        if (mode.includes('s')) {
          height = Math.min(maxH - y, Math.max(minSize, origCrop.height + dy));
        }
        // Nord (haut)
        if (mode.includes('n')) {
          const maxDy = origCrop.height - minSize;
          const clampedDy = Math.min(maxDy, Math.max(-origCrop.y, dy));
          y = origCrop.y + clampedDy;
          height = origCrop.height - clampedDy;
        }

        this.crop = {
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(width),
          height: Math.round(height)
        };
      }

      this.updateCropBoxDOM();
    };

    const onPointerUp = (e) => {
      if (!this.activeDrag || (e.pointerId !== undefined && e.pointerId !== this.activeDrag.pointerId)) return;
      this.activeDrag = null;
    };

    this.cropBoxEl.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  },

  /**
   * Ignore le recadrage : applique la rotation si nécessaire puis analyse
   */
  skip() {
    if (!this.rawImage) return;

    if (this.rotation === 0) {
      const src = this.rawSource;
      this.close();
      if (typeof this.onConfirmCallback === 'function') {
        this.onConfirmCallback(src);
      }
      return;
    }

    // Si l'utilisateur a fait pivoter l'image, conserver l'orientation
    const canvas = document.createElement('canvas');
    canvas.width = this.orientedWidth;
    canvas.height = this.orientedHeight;
    const ctx = canvas.getContext('2d');
    ctx.translate(this.orientedWidth / 2, this.orientedHeight / 2);
    ctx.rotate((this.rotation * Math.PI) / 180);

    const isRotated = this.rotation === 90 || this.rotation === 270;
    if (isRotated) {
      ctx.drawImage(this.rawImage, -this.orientedHeight / 2, -this.orientedWidth / 2, this.orientedHeight, this.orientedWidth);
    } else {
      ctx.drawImage(this.rawImage, -this.orientedWidth / 2, -this.orientedHeight / 2, this.orientedWidth, this.orientedHeight);
    }

    const rotatedDataUrl = canvas.toDataURL('image/jpeg', 0.90);
    this.close();
    if (typeof this.onConfirmCallback === 'function') {
      this.onConfirmCallback(rotatedDataUrl);
    }
  },

  /**
   * Découpe la portion sélectionnée en haute définition et lance l'analyse
   */
  confirm() {
    if (!this.rawImage || !this.displayedWidth || !this.displayedHeight) return;

    // Facteurs d'échelle vers la résolution originale orientée
    const scaleX = this.orientedWidth / this.displayedWidth;
    const scaleY = this.orientedHeight / this.displayedHeight;

    const realCropX = Math.round(this.crop.x * scaleX);
    const realCropY = Math.round(this.crop.y * scaleY);
    const realCropW = Math.round(this.crop.width * scaleX);
    const realCropH = Math.round(this.crop.height * scaleY);

    if (realCropW <= 10 || realCropH <= 10) {
      this.skip();
      return;
    }

    // 1. Dessin de l'image complète orientée sur canvas tampon
    const orientedCanvas = document.createElement('canvas');
    orientedCanvas.width = this.orientedWidth;
    orientedCanvas.height = this.orientedHeight;
    const oCtx = orientedCanvas.getContext('2d');

    oCtx.translate(this.orientedWidth / 2, this.orientedHeight / 2);
    oCtx.rotate((this.rotation * Math.PI) / 180);

    const isRotated = this.rotation === 90 || this.rotation === 270;
    if (isRotated) {
      oCtx.drawImage(this.rawImage, -this.orientedHeight / 2, -this.orientedWidth / 2, this.orientedHeight, this.orientedWidth);
    } else {
      oCtx.drawImage(this.rawImage, -this.orientedWidth / 2, -this.orientedHeight / 2, this.orientedWidth, this.orientedHeight);
    }

    // 2. Découpe exacte du rectangle de crop
    const outCanvas = document.createElement('canvas');
    outCanvas.width = realCropW;
    outCanvas.height = realCropH;
    const outCtx = outCanvas.getContext('2d');

    outCtx.drawImage(
      orientedCanvas,
      realCropX, realCropY, realCropW, realCropH,
      0, 0, realCropW, realCropH
    );

    const croppedDataUrl = outCanvas.toDataURL('image/jpeg', 0.90);
    this.close();

    if (typeof this.onConfirmCallback === 'function') {
      this.onConfirmCallback(croppedDataUrl);
    }
  }
};
