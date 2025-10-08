import * as THREE from 'three';

class Scoreboard {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 2048; // Wider canvas for the 12-arrow layout
        this.canvas.height = 256;
        this.context = this.canvas.getContext('2d');

        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.encoding = THREE.sRGBEncoding;
        this.texture.anisotropy = 16;

        // Adjust plane geometry to match the new aspect ratio
        const material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, side: THREE.DoubleSide });
        const geometry = new THREE.PlaneGeometry(4, 0.5);
        this.mesh = new THREE.Mesh(geometry, material);

        this.scores = []; // Holds up to 12 scores
        this.end1Total = 0;
        this.end2Total = 0;
        this.hits = 0;
        this.golds = 0;
        this.dozenTotal = 0;

        this.draw(); // Initial drawing
    }

    draw() {
        const ctx = this.context;
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Background
        ctx.fillStyle = '#003366'; // Dark blue background
        ctx.fillRect(0, 0, w, h);

        // Header and cell drawing
        ctx.strokeStyle = 'white';
        ctx.fillStyle = 'white';
        ctx.font = 'bold 32px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const headers = [
            // End 1
            "1", "2", "3", "4", "5", "6", "END",
            // End 2
            "7", "8", "9", "10", "11", "12", "END",
            // Summary
            "H", "G", "Dozen", "R/T"
        ];
        const cellWidth = w / headers.length;

        // Draw header text and boxes
        headers.forEach((header, i) => {
            const x = i * cellWidth;
            ctx.strokeRect(x, 0, cellWidth, h / 2);
            ctx.fillText(header, x + cellWidth / 2, h * 0.25);
        });

        // Draw empty score boxes
        for (let i = 0; i < headers.length; i++) {
            const x = i * cellWidth;
            ctx.strokeRect(x, h / 2, cellWidth, h / 2);
        }

        this.texture.needsUpdate = true;
    }

    // newScores is an array for the current round (3 arrows)
    updateScores(newScores) {
        this.scores.push(...newScores);
        this.scores = this.scores.slice(0, 12); // Max 12 scores

        this.calculateTotals();
        this.redrawScores();
    }

    calculateTotals() {
        const parseScore = (s) => {
            if (s === 'X') return 10;
            if (s === 'M') return 0;
            return parseInt(s) || 0;
        };

        const scoresNumeric = this.scores.map(parseScore);

        if (scoresNumeric.length > 0) {
            this.end1Total = scoresNumeric.slice(0, 6).reduce((a, b) => a + b, 0);
        }
        if (scoresNumeric.length > 6) {
            this.end2Total = scoresNumeric.slice(6, 12).reduce((a, b) => a + b, 0);
        }

        this.dozenTotal = this.end1Total + this.end2Total;
        this.hits = this.scores.filter(s => s !== 'M').length;
        this.golds = this.scores.filter(s => s === 'X' || s === '10').length;
    }

    redrawScores() {
        const ctx = this.context;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const headers = ["1", "2", "3", "4", "5", "6", "END", "7", "8", "9", "10", "11", "12", "END", "H", "G", "Dozen", "R/T"];
        const cellWidth = w / headers.length;
        const scoreY = h * 0.75;

        // Clear previous scores area
        ctx.fillStyle = '#003366';
        ctx.fillRect(0, h / 2, w, h / 2);
        for (let i = 0; i < headers.length; i++) {
            const x = i * cellWidth;
            ctx.strokeRect(x, h / 2, cellWidth, h / 2);
        }

        ctx.fillStyle = 'white';
        ctx.font = '48px sans-serif';

        // Map score index to cell index
        const getCellIndex = (scoreIndex) => {
            if (scoreIndex < 6) return scoreIndex;      // Scores 1-6 -> Cells 0-5
            if (scoreIndex < 12) return scoreIndex + 1; // Scores 7-12 -> Cells 7-12
            return -1;
        };

        // Draw individual arrow scores
        this.scores.forEach((score, i) => {
            const cellIndex = getCellIndex(i);
            if (cellIndex !== -1) {
                const x = cellIndex * cellWidth + cellWidth / 2;
                ctx.fillText(score.toString(), x, scoreY);
            }
        });

        // Draw END 1 Total (after 6 arrows are scored)
        if (this.scores.length >= 6) {
            ctx.fillText(this.end1Total.toString(), 6 * cellWidth + cellWidth / 2, scoreY);
        }

        // Draw END 2 Total (after 12 arrows are scored)
        if (this.scores.length >= 12) {
            ctx.fillText(this.end2Total.toString(), 13 * cellWidth + cellWidth / 2, scoreY);
        }

        // Draw Summary fields (H, G, Dozen, R/T)
        // These are continuously updated
        ctx.fillText(this.hits.toString(), 14 * cellWidth + cellWidth / 2, scoreY);
        ctx.fillText(this.golds.toString(), 15 * cellWidth + cellWidth / 2, scoreY);
        if (this.scores.length >= 12) {
            ctx.fillText(this.dozenTotal.toString(), 16 * cellWidth + cellWidth / 2, scoreY);
            ctx.fillText(this.dozenTotal.toString(), 17 * cellWidth + cellWidth / 2, scoreY);
        }

        this.texture.needsUpdate = true;
    }

    reset() {
        this.scores = [];
        this.end1Total = 0;
        this.end2Total = 0;
        this.hits = 0;
        this.golds = 0;
        this.dozenTotal = 0;
        this.draw(); // Redraw initial empty board
    }

    getMesh() {
        return this.mesh;
    }
}

export { Scoreboard };