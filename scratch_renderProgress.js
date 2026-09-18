function renderProgress() {
  const logs = DB.logs().filter(l => l.type !== 'session_complete');
  const bw = DB.bw();

  // Calculate summary stats
  let totalVolume = 0; const totalExercises = new Set();
  logs.forEach(l => {
    totalExercises.add(l.exercise);
    if (l.sets) l.sets.forEach(s => { const w = parseFloat(s.weight)||0, r = parseFloat(s.reps)||0; if (w && r) totalVolume += w * r; });
  });
  const sessionDates = new Set(DB.logs().filter(l => l.type === 'session_complete').map(l => l.date));
  const totalSessions = sessionDates.size;

  // Summary cards
  const summaryEl = document.getElementById('analytics-summary');
  if (summaryEl) summaryEl.innerHTML = `
    <div class="analytics-stat">
      <div class="analytics-stat-label">Sessions</div>
      <div class="analytics-stat-value">${totalSessions}</div>
    </div>
    <div class="analytics-stat">
      <div class="analytics-stat-label">Total Volume</div>
      <div class="analytics-stat-value">${totalVolume >= 1000 ? (totalVolume/1000).toFixed(1) : Math.round(totalVolume)}<span>${totalVolume >= 1000 ? 'T' : bw.unit}</span></div>
    </div>
    <div class="analytics-stat">
      <div class="analytics-stat-label">Exercises</div>
      <div class="analytics-stat-value">${totalExercises.size}</div>
    </div>
    <div class="analytics-stat">
      <div class="analytics-stat-label">Bodyweight</div>
      <div class="analytics-stat-value">${bw.weight}<span>${bw.unit}</span></div>
    </div>
  `;

  // Build per-exercise data
  const exerciseMap = {};
  logs.forEach(l => {
    if (!l.exercise || !l.sets || l.sets.length === 0) return;
    if (!exerciseMap[l.exercise]) exerciseMap[l.exercise] = { name: l.exercise, sessions: {}, muscle: l.muscle || '', emoji: '' };
    const maxW = Math.max(...l.sets.map(s => parseFloat(s.weight) || 0));
    if (maxW > 0) {
      if (!exerciseMap[l.exercise].sessions[l.date] || maxW > exerciseMap[l.exercise].sessions[l.date]) {
        exerciseMap[l.exercise].sessions[l.date] = maxW;
      }
    }
  });

  // Find emoji
  for (const exName of Object.keys(exerciseMap)) {
    for (const muscle of Object.keys(BASE_EXERCISES)) {
      const found = BASE_EXERCISES[muscle].find(e => e.name === exName);
      if (found) { exerciseMap[exName].emoji = found.emoji || ''; break; }
    }
    if (!exerciseMap[exName].emoji) {
      const customs = DB.customExercises();
      for (const muscle of Object.keys(customs)) {
        const found = customs[muscle].find(c => c.name === exName);
        if (found) { exerciseMap[exName].emoji = found.emoji || ''; break; }
      }
    }
  }

  const listEl = document.getElementById('exercise-progress-list');
  if (!listEl) return;
  const exercises = Object.values(exerciseMap).filter(e => Object.keys(e.sessions).length > 0);
  exercises.sort((a, b) => Math.max(...Object.values(b.sessions)) - Math.max(...Object.values(a.sessions)));

  if (exercises.length === 0) {
    listEl.innerHTML = '<div class="no-data-msg"><span>No exercise data logged yet.</span></div>';
    renderHeatmap();
    return;
  }

  listEl.innerHTML = '';
  exercises.forEach(ex => {
    const dates = Object.keys(ex.sessions).sort();
    const values = dates.map(d => ex.sessions[d]);
    const currentMax = Math.max(...values);
    const tier = getStrengthTier(ex.name, currentMax);
    const unit = bw.unit || 'kg';

    const card = document.createElement('div');
    card.className = 'exercise-progress-card';
    card.onclick = () => openExerciseDetail(ex.name, ex.sessions, ex.emoji);

    const tierBadge = tier.tier >= 0 ? `<span class="strength-badge ${tier.cls}">${tier.name}</span>` : '';
    const safeId = ex.name.replace(/[^a-zA-Z0-9]/g,'_');
    card.innerHTML = `
      <div class="ep-icon">${ex.emoji || '\u2699\uFE0F'}</div>
      <div class="ep-info">
        <div class="ep-name">${escapeHTML(ex.name)}</div>
        <div class="ep-meta">${tierBadge}<span>${dates.length} session${dates.length!==1?'s':''}</span></div>
      </div>
      <canvas class="ep-sparkline" id="spark-${safeId}"></canvas>
      <div class="ep-max">
        <div class="ep-max-val">${currentMax}</div>
        <div class="ep-max-unit">${unit}</div>
      </div>
    `;
    listEl.appendChild(card);

    // Draw sparkline
    setTimeout(() => {
      const canvas = card.querySelector('canvas');
      if (!canvas || values.length === 0) return;
      const ctx2 = canvas.getContext('2d');
      // Ensure canvas has dimensions, wait if 0
      if (canvas.offsetWidth === 0) return;
      
      const w2 = canvas.width = canvas.offsetWidth * 2;
      const h2 = canvas.height = canvas.offsetHeight * 2;
      ctx2.scale(2, 2);
      const cw = canvas.offsetWidth, ch = canvas.offsetHeight;
      const minV = Math.min(...values) * 0.9, maxV = Math.max(...values) * 1.1;
      const range = maxV - minV || 1;

      ctx2.beginPath();
      ctx2.strokeStyle = '#eab308';
      ctx2.lineWidth = 2;
      ctx2.lineJoin = 'round';
      ctx2.lineCap = 'round';
      
      if (values.length === 1) {
        ctx2.moveTo(0, ch/2);
        ctx2.lineTo(cw, ch/2);
      } else {
        values.forEach((v, i) => {
          const x = (i / (values.length - 1)) * cw;
          const y = ch - ((v - minV) / range) * ch;
          if (i === 0) ctx2.moveTo(x, y); else ctx2.lineTo(x, y);
        });
      }
      ctx2.stroke();

      ctx2.lineTo(cw, ch);
      ctx2.lineTo(0, ch);
      ctx2.closePath();
      const grad = ctx2.createLinearGradient(0, 0, 0, ch);
      grad.addColorStop(0, 'rgba(234,179,8,0.2)');
      grad.addColorStop(1, 'rgba(234,179,8,0)');
      ctx2.fillStyle = grad;
      ctx2.fill();
      
      // Draw a dot for the latest value
      const lastX = cw;
      const lastY = values.length === 1 ? ch/2 : ch - ((values[values.length-1] - minV) / range) * ch;
      ctx2.beginPath();
      ctx2.arc(lastX - 3, lastY, 3, 0, Math.PI * 2);
      ctx2.fillStyle = '#eab308';
      ctx2.fill();
    }, 150);
  });

  renderHeatmap();
}