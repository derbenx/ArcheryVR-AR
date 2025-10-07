import * as THREE from 'three';

class Scoreboard {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 1024; // Increased resolution for clarity
        this.canvas.height = 256;
        this.context = this.canvas.getContext('2d');

        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.encoding = THREE.sRGBEncoding;
        this.texture.anisotropy = 16;

        const material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true });
        const geometry = new THREE.PlaneGeometry(2, 0.5); // Wider for the new layout
        this.mesh = new THREE.Mesh(geometry, material);

        this.scores = []; // An array to hold up to 6 scores
        this.end1Total = 0;
        this.end2Total = 0;
        this.hits = 0;
        this.golds = 0;

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

        const cellW = w / 13; // 6 scores + END + 6 scores + END + H + G + Dozen + R/T -> let's simplify for 6 arrows + 2 ends
        const numScoreCells = 6;
        const end1CellIndex = 3;
        const end2CellIndex = 7; // 3 scores + end1 + 3 scores = 7
        const totalCells = 12; // 3 scores, end, 3 scores, end, H, G, Total

        const headers = [
            // End 1
            "1", "2", "3", "END",
            // End 2
            "4", "5", "6", "END",
            // Summary
            "H", "G", "TOTAL"
        ];
        const cellWidth = w / headers.length;


        // Draw header text and boxes
        headers.forEach((header, i) => {
            const x = i * cellWidth;
            ctx.strokeRect(x, 0, cellWidth, h / 2);
            ctx.fillText(header, x + cellWidth / 2, h * 0.25);
        });


        // Draw score boxes
        for (let i = 0; i < headers.length; i++) {
             const x = i * cellWidth;
             ctx.strokeRect(x, h/2, cellWidth, h/2);
        }


        this.texture.needsUpdate = true;
    }

    // Scores should be an array of strings ('X', '10', '9', ..., 'M')
    updateScores(newScores) {
        // newScores is an array for the current end (3 arrows)
        this.scores.push(...newScores);

        this.calculateTotals();
        this.redrawScores();
    }

    calculateTotals() {
        const parseScore = (s) => {
            if (s === 'X') return 10; // 'X' is worth 10 points for the total
            if (s === 'M') return 0;
            return parseInt(s) || 0;
        };

        const scoresNumeric = this.scores.map(parseScore);

        this.end1Total = scoresNumeric.slice(0, 3).reduce((a, b) => a + b, 0);
        this.end2Total = scoresNumeric.slice(3, 6).reduce((a, b) => a + b, 0);

        this.hits = this.scores.filter(s => s !== 'M').length;
        this.golds = this.scores.filter(s => {
            const scoreVal = parseInt(s);
            return s === 'X' || scoreVal === 10 || scoreVal === 9;
        }).length;
    }

    redrawScores() {
        const ctx = this.context;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const headers = ["1", "2", "3", "END", "4", "5", "6", "END", "H", "G", "TOTAL"];
        const cellWidth = w / headers.length;
        const scoreY = h * 0.75;

        // Clear previous scores
        ctx.fillStyle = '#003366';
        ctx.fillRect(0, h / 2, w, h / 2);
        for (let i = 0; i < headers.length; i++) {
             const x = i * cellWidth;
             ctx.strokeRect(x, h/2, cellWidth, h/2);
        }


        ctx.fillStyle = 'white';
        ctx.font = '48px sans-serif';

        // Draw individual arrow scores
        const scoreIndices = [0, 1, 2, 4, 5, 6];
        this.scores.forEach((score, i) => {
            const cellIndex = scoreIndices[i];
            if (cellIndex !== undefined) {
                const x = cellIndex * cellWidth + cellWidth / 2;
                ctx.fillText(score, x, scoreY);
            }
        });

        // Draw END 1 Total
        if (this.scores.length >= 3) {
            const end1X = 3 * cellWidth + cellWidth / 2;
            ctx.fillText(this.end1Total.toString(), end1X, scoreY);
        }

        // Draw END 2 Total
        if (this.scores.length >= 6) {
             const end2X = 7 * cellWidth + cellWidth / 2;
            ctx.fillText(this.end2Total.toString(), end2X, scoreY);
        }

        // Draw H, G, and Total
        const summaryX = [
            8 * cellWidth + cellWidth / 2,
            9 * cellWidth + cellWidth / 2,
            10 * cellWidth + cellWidth / 2
        ];
        ctx.fillText(this.hits.toString(), summaryX[0], scoreY);
        ctx.fillText(this.golds.toString(), summaryX[1], scoreY);
        ctx.fillText((this.end1Total + this.end2Total).toString(), summaryX[2], scoreY);


        this.texture.needsUpdate = true;
    }

    reset() {
        this.scores = [];
        this.end1Total = 0;
        this.end2Total = 0;
        this.hits = 0;
        this.golds = 0;
        this.draw(); // Redraw initial empty board
    }

    getMesh() {
        return this.mesh;
    }
}

export { Scoreboard };