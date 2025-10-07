import * as THREE from 'three';

class Scoreboard {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 2048; // Wider for more columns
        this.canvas.height = 512;
        this.context = this.canvas.getContext('2d');

        this.texture = new THREE.CanvasTexture(this.canvas);
        const material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true });
        // Aspect ratio is 2048/512 = 4. So plane is 4x1.
        const geometry = new THREE.PlaneGeometry(4, 1);
        this.mesh = new THREE.Mesh(geometry, material);

        this.scores = []; // All scores for the current dozen, max 12.
        this.drawBoard();
    }

    drawBoard() {
        const ctx = this.context;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const cellWidth = w / 18;

        // Background
        ctx.fillStyle = '#01579b';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 8;
        ctx.strokeRect(0, 0, w, h);

        // Styling
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 40px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Headers
        const headers = [
            // 6 empty headers for scores
            ...Array(6).fill(''), 'END',
            // 6 empty headers for scores
            ...Array(6).fill(''), 'END',
            'H', 'G', 'Dozen', 'R/T'
        ];
        const headerY = h * 0.25;

        headers.forEach((header, i) => {
            if (header) {
                const x = (i + 0.5) * cellWidth;
                ctx.fillText(header, x, headerY);
            }
        });

        // Grid lines
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 4;
        ctx.beginPath();
        // Vertical lines
        for (let i = 1; i < 18; i++) {
            // Thicker lines for END columns
            if(i === 7 || i === 14) {
                 ctx.lineWidth = 8;
            } else {
                ctx.lineWidth = 4;
            }
            const x = i * cellWidth;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
        }
        // Horizontal line
        ctx.moveTo(0, h * 0.5);
        ctx.lineTo(w, h * 0.5);
        ctx.stroke();

        // Draw scores and totals
        this.drawScores();

        this.texture.needsUpdate = true;
    }

    drawScores() {
        const ctx = this.context;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const cellWidth = w / 18;
        const scoreY = h * 0.75;

        ctx.font = 'bold 48px Arial';
        ctx.fillStyle = '#FFFFFF';

        let end1Total = 0;
        let end2Total = 0;
        let totalHits = 0;
        let totalGolds = 0;

        // Draw individual scores
        for (let i = 0; i < 12; i++) {
            const score = this.scores[i];
            if (score === undefined) continue;

            const scoreText = this.formatScore(score);
            const col = (i < 6) ? i : i + 2; // Skip first END column
            const x = (col + 0.5) * cellWidth;
            ctx.fillText(scoreText, x, scoreY);

            if (score > 0) {
                totalHits++;
                if (score >= 9) totalGolds++;
                if (i < 6) {
                    end1Total += score;
                } else {
                    end2Total += score;
                }
            }
        }

        // Draw totals
        if (this.scores.length > 0) {
            // End 1 Total
            if (this.scores.length >= 6) {
                 ctx.fillText(end1Total.toString(), (6.5 * cellWidth), scoreY);
            }
            // End 2 Total
            if (this.scores.length >= 12) {
                 ctx.fillText(end2Total.toString(), (13.5 * cellWidth), scoreY);
            }

            // Final Totals (always update as scores are added)
            const dozenTotal = end1Total + end2Total;
            ctx.fillText(totalHits.toString(), (14.5 * cellWidth), scoreY);
            ctx.fillText(totalGolds.toString(), (15.5 * cellWidth), scoreY);
            ctx.fillText(dozenTotal.toString(), (16.5 * cellWidth), scoreY);
            ctx.fillText(dozenTotal.toString(), (17.5 * cellWidth), scoreY);
        }
    }

    // Called every 3 arrows
    addScores(newScores) { // e.g., [10, 9, 8]
        // sort scores high to low
        newScores.sort((a, b) => b - a);
        this.scores.push(...newScores);
        if (this.scores.length > 12) {
            // This would be for starting a new dozen
            this.scores.splice(0, this.scores.length - 12);
        }
        this.drawBoard(); // Redraw everything
    }

    formatScore(score) {
        if (score === 11) return 'X';
        if (score === 0) return 'M';
        return score.toString();
    }

    clear() {
        this.scores = [];
        this.drawBoard();
    }
}

export { Scoreboard };