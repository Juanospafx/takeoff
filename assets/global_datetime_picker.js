/**
 * Global Custom Date & Time Picker for Brightronix Takeoff
 * Provides a unified, beautiful date and time picker across all inputs.
 * Strictly enforces 10-minute intervals (00, 10, 20, 30, 40, 50) on all time selections.
 */
(function () {
    const MONTH_NAMES = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    const MINUTES_10 = ['00', '10', '20', '30', '40', '50'];
    const HOURS_12 = ['12', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11'];

    let activeInput = null;
    let popoverEl = null;

    // Working state
    let state = {
        mode: 'date', // 'date' | 'time' | 'datetime'
        year: 2026,
        month: 8, // 0-indexed (8 = September)
        day: 24,
        hour: '12',
        minute: '00',
        period: 'PM'
    };

    function initPopover() {
        if (popoverEl) return;

        popoverEl = document.createElement('div');
        popoverEl.className = 'gdp-popover';
        popoverEl.id = 'globalDateTimePicker';
        popoverEl.setAttribute('role', 'dialog');
        popoverEl.setAttribute('aria-modal', 'true');

        popoverEl.innerHTML = `
            <div class="gdp-wrapper">
                <div class="gdp-main-content" id="gdpMainContent"></div>
                <div class="gdp-footer" id="gdpFooter"></div>
            </div>
        `;

        document.body.appendChild(popoverEl);

        // Prevent clicking inside popover from bubbling and closing
        popoverEl.addEventListener('click', (e) => e.stopPropagation());

        // Close on clicking outside or pressing Escape
        document.addEventListener('click', (e) => {
            if (!popoverEl || !popoverEl.classList.contains('open')) return;
            if (activeInput && (e.target === activeInput || activeInput.contains(e.target))) return;
            if (e.target.closest('.pd-input-icon-wrap')) return;
            closePicker();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && popoverEl && popoverEl.classList.contains('open')) {
                closePicker();
            }
        });

        window.addEventListener('resize', () => {
            if (popoverEl && popoverEl.classList.contains('open') && activeInput) {
                positionPopover();
            }
        });
        window.addEventListener('scroll', () => {
            if (popoverEl && popoverEl.classList.contains('open') && activeInput) {
                positionPopover();
            }
        }, true);
    }

    function parseInput(input) {
        activeInput = input;
        const type = input.getAttribute('type') || input.dataset.picker || 'date';
        const val = (input.value || '').trim();

        if (type === 'time') {
            state.mode = 'time';
        } else if (type === 'datetime-local') {
            state.mode = 'datetime';
        } else {
            state.mode = 'date';
        }

        const now = new Date();
        state.year = now.getFullYear();
        state.month = now.getMonth();
        state.day = now.getDate();

        // Round current minutes to nearest 10
        let currentMins = Math.round(now.getMinutes() / 10) * 10;
        if (currentMins >= 60) currentMins = 50;
        state.minute = String(currentMins).padStart(2, '0');

        let rawH = now.getHours();
        state.period = rawH >= 12 ? 'PM' : 'AM';
        let h12 = rawH % 12;
        if (h12 === 0) h12 = 12;
        state.hour = String(h12).padStart(2, '0');

        if (val) {
            if (state.mode === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
                const parts = val.split('-');
                state.year = parseInt(parts[0], 10);
                state.month = parseInt(parts[1], 10) - 1;
                state.day = parseInt(parts[2], 10);
            } else if (state.mode === 'time') {
                parseTimeString(val);
            } else if (state.mode === 'datetime' && val.includes('T')) {
                const [dPart, tPart] = val.split('T');
                if (dPart && /^\d{4}-\d{2}-\d{2}$/.test(dPart)) {
                    const parts = dPart.split('-');
                    state.year = parseInt(parts[0], 10);
                    state.month = parseInt(parts[1], 10) - 1;
                    state.day = parseInt(parts[2], 10);
                }
                if (tPart) parseTimeString(tPart);
            }
        }
    }

    function parseTimeString(tStr) {
        const match = tStr.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
        if (match) {
            let h = parseInt(match[1], 10);
            let m = parseInt(match[2], 10);
            let p = match[3] ? match[3].toUpperCase() : null;

            // Snap minutes to nearest 10
            let snapM = Math.round(m / 10) * 10;
            if (snapM >= 60) snapM = 50;
            state.minute = String(snapM).padStart(2, '0');

            if (p) {
                state.period = p;
                state.hour = String(h).padStart(2, '0');
            } else {
                state.period = h >= 12 ? 'PM' : 'AM';
                let h12 = h % 12;
                if (h12 === 0) h12 = 12;
                state.hour = String(h12).padStart(2, '0');
            }
        }
    }

    function renderUI() {
        initPopover();
        const mainEl = document.getElementById('gdpMainContent');
        const footEl = document.getElementById('gdpFooter');
        if (!mainEl || !footEl) return;

        let mainHtml = '';
        if (state.mode === 'date' || state.mode === 'datetime') {
            mainHtml += renderCalendarHtml();
        }
        if (state.mode === 'time' || state.mode === 'datetime') {
            mainHtml += renderTimeHtml(state.mode === 'time');
        }
        mainEl.innerHTML = mainHtml;

        footEl.innerHTML = `
            <button type="button" class="gdp-action-btn" id="gdpClearBtn">Clear</button>
            <button type="button" class="gdp-action-btn" id="gdpTodayBtn">${state.mode === 'time' ? 'Now' : 'Today'}</button>
            <button type="button" class="gdp-action-btn done-btn" id="gdpDoneBtn">Done</button>
        `;

        attachEventListeners();
    }

    function renderCalendarHtml() {
        const firstDay = new Date(state.year, state.month, 1).getDay();
        const daysInMonth = new Date(state.year, state.month + 1, 0).getDate();
        const today = new Date();
        const isCurrentMonth = today.getFullYear() === state.year && today.getMonth() === state.month;

        let gridHtml = '';
        // Empty cells for offset
        for (let i = 0; i < firstDay; i++) {
            gridHtml += `<button type="button" class="gdp-day-btn empty" tabindex="-1"></button>`;
        }
        for (let d = 1; d <= daysInMonth; d++) {
            const isToday = isCurrentMonth && today.getDate() === d;
            const isSelected = state.day === d;
            const cls = `gdp-day-btn ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}`;
            gridHtml += `<button type="button" class="${cls}" data-day="${d}">${d}</button>`;
        }

        return `
            <div class="gdp-calendar-section">
                <div class="gdp-header">
                    <span class="gdp-title">${MONTH_NAMES[state.month]} ${state.year}</span>
                    <div class="gdp-nav-btns">
                        <button type="button" class="gdp-nav-btn" id="gdpPrevMonth" aria-label="Previous month"><i class="fas fa-chevron-left"></i></button>
                        <button type="button" class="gdp-nav-btn" id="gdpNextMonth" aria-label="Next month"><i class="fas fa-chevron-right"></i></button>
                    </div>
                </div>
                <div class="gdp-weekdays-row">
                    ${DAY_NAMES.map(d => `<span>${d}</span>`).join('')}
                </div>
                <div class="gdp-days-grid">
                    ${gridHtml}
                </div>
            </div>
        `;
    }

    function renderTimeHtml(standalone = false) {
        const formattedDisplay = `${state.hour}:${state.minute} ${state.period}`;

        const hoursHtml = HOURS_12.map(h => {
            const sel = state.hour === h ? 'selected' : '';
            return `<button type="button" class="gdp-pill-btn ${sel}" data-hour="${h}">${h}</button>`;
        }).join('');

        const minutesHtml = MINUTES_10.map(m => {
            const sel = state.minute === m ? 'selected' : '';
            return `<button type="button" class="gdp-pill-btn ${sel}" data-minute="${m}">${m}</button>`;
        }).join('');

        return `
            <div class="gdp-time-section ${standalone ? 'standalone' : ''}">
                <div class="gdp-time-display">${formattedDisplay}</div>
                <div class="gdp-time-columns">
                    <div class="gdp-time-col">
                        <div class="gdp-col-label">Hour</div>
                        <div class="gdp-scroll-box">${hoursHtml}</div>
                    </div>
                    <div class="gdp-time-col">
                        <div class="gdp-col-label">Min (10s)</div>
                        <div class="gdp-scroll-box minutes">${minutesHtml}</div>
                    </div>
                    <div class="gdp-ampm-wrap">
                        <div class="gdp-col-label">&nbsp;</div>
                        <button type="button" class="gdp-pill-btn ${state.period === 'AM' ? 'selected' : ''}" data-period="AM">AM</button>
                        <button type="button" class="gdp-pill-btn ${state.period === 'PM' ? 'selected' : ''}" data-period="PM">PM</button>
                    </div>
                </div>
            </div>
        `;
    }

    function attachEventListeners() {
        const prevBtn = document.getElementById('gdpPrevMonth');
        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                state.month--;
                if (state.month < 0) {
                    state.month = 11;
                    state.year--;
                }
                renderUI();
                positionPopover();
            });
        }

        const nextBtn = document.getElementById('gdpNextMonth');
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                state.month++;
                if (state.month > 11) {
                    state.month = 0;
                    state.year++;
                }
                renderUI();
                positionPopover();
            });
        }

        popoverEl.querySelectorAll('[data-day]').forEach(btn => {
            btn.addEventListener('click', () => {
                state.day = parseInt(btn.dataset.day, 10);
                syncValueToInput();
                renderUI();
                positionPopover();
            });
        });

        popoverEl.querySelectorAll('[data-hour]').forEach(btn => {
            btn.addEventListener('click', () => {
                state.hour = btn.dataset.hour;
                syncValueToInput();
                renderUI();
                positionPopover();
            });
        });

        popoverEl.querySelectorAll('[data-minute]').forEach(btn => {
            btn.addEventListener('click', () => {
                state.minute = btn.dataset.minute;
                syncValueToInput();
                renderUI();
                positionPopover();
            });
        });

        popoverEl.querySelectorAll('[data-period]').forEach(btn => {
            btn.addEventListener('click', () => {
                state.period = btn.dataset.period;
                syncValueToInput();
                renderUI();
                positionPopover();
            });
        });

        const clearBtn = document.getElementById('gdpClearBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (activeInput) {
                    activeInput.value = '';
                    activeInput.dispatchEvent(new Event('input', { bubbles: true }));
                    activeInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
                closePicker();
            });
        }

        const todayBtn = document.getElementById('gdpTodayBtn');
        if (todayBtn) {
            todayBtn.addEventListener('click', () => {
                const now = new Date();
                state.year = now.getFullYear();
                state.month = now.getMonth();
                state.day = now.getDate();

                let currentMins = Math.round(now.getMinutes() / 10) * 10;
                if (currentMins >= 60) currentMins = 50;
                state.minute = String(currentMins).padStart(2, '0');

                let rawH = now.getHours();
                state.period = rawH >= 12 ? 'PM' : 'AM';
                let h12 = rawH % 12;
                if (h12 === 0) h12 = 12;
                state.hour = String(h12).padStart(2, '0');

                syncValueToInput();
                renderUI();
                positionPopover();
            });
        }

        const doneBtn = document.getElementById('gdpDoneBtn');
        if (doneBtn) {
            doneBtn.addEventListener('click', closePicker);
        }
    }

    function syncValueToInput() {
        if (!activeInput) return;

        const yStr = String(state.year);
        const mStr = String(state.month + 1).padStart(2, '0');
        const dStr = String(state.day).padStart(2, '0');

        let h24 = parseInt(state.hour, 10);
        if (state.period === 'PM' && h24 < 12) h24 += 12;
        if (state.period === 'AM' && h24 === 12) h24 = 0;
        const h24Str = String(h24).padStart(2, '0');
        const minStr = state.minute;

        const inputType = activeInput.getAttribute('type');

        if (state.mode === 'date') {
            activeInput.value = `${yStr}-${mStr}-${dStr}`;
        } else if (state.mode === 'time') {
            if (inputType === 'time') {
                activeInput.value = `${h24Str}:${minStr}`;
            } else {
                activeInput.value = `${state.hour}:${minStr} ${state.period}`;
            }
        } else if (state.mode === 'datetime') {
            if (inputType === 'datetime-local') {
                activeInput.value = `${yStr}-${mStr}-${dStr}T${h24Str}:${minStr}`;
            } else {
                activeInput.value = `${yStr}-${mStr}-${dStr} ${state.hour}:${minStr} ${state.period}`;
            }
        }

        activeInput.dispatchEvent(new Event('input', { bubbles: true }));
        activeInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function positionPopover() {
        if (!activeInput || !popoverEl) return;
        const targetEl = activeInput.closest('.pd-input-icon-wrap') || activeInput;
        const rect = targetEl.getBoundingClientRect();
        const zoom = parseFloat(getComputedStyle(document.documentElement).zoom)
            || parseFloat(getComputedStyle(document.body).zoom)
            || 1;

        const popoverWidth = (popoverEl.offsetWidth || 270);
        const popoverHeight = (popoverEl.offsetHeight || 290);
        const margin = 8;

        // Unzoomed CSS viewport coordinates
        let left = rect.left / zoom;
        let top = (rect.bottom / zoom) + 4;

        const vpWidth = window.innerWidth / zoom;
        const vpHeight = window.innerHeight / zoom;

        if (left + popoverWidth > vpWidth - margin) {
            left = vpWidth - popoverWidth - margin;
        }
        if (left < margin) left = margin;

        if (top + popoverHeight > vpHeight - margin) {
            const topAlt = (rect.top / zoom) - popoverHeight - 4;
            if (topAlt > margin) {
                top = topAlt;
            }
        }

        popoverEl.style.left = `${Math.round(left)}px`;
        popoverEl.style.top = `${Math.round(top)}px`;
    }

    function openPicker(input) {
        if (activeInput === input && popoverEl && popoverEl.classList.contains('open')) {
            return;
        }
        parseInput(input);
        renderUI();
        popoverEl.classList.add('open');
        positionPopover();
    }

    function closePicker() {
        if (popoverEl) {
            popoverEl.classList.remove('open');
        }
        activeInput = null;
    }

    function attachToInputs() {
        const selector = 'input[type="date"], input[type="time"], input[type="datetime-local"], input[data-picker]';
        document.querySelectorAll(selector).forEach(input => {
            if (input._gdpAttached) return;
            input._gdpAttached = true;

            if (input.getAttribute('type') === 'time') {
                input.setAttribute('step', '600');
            }

            input.addEventListener('click', (e) => {
                e.stopPropagation();
                openPicker(input);
            });

            // Also attach to icon inside parent .pd-input-icon-wrap
            const wrap = input.closest('.pd-input-icon-wrap');
            if (wrap) {
                wrap.style.cursor = 'pointer';
                const icon = wrap.querySelector('.pd-input-icon-right');
                if (icon) {
                    icon.style.cursor = 'pointer';
                    icon.addEventListener('click', (e) => {
                        e.stopPropagation();
                        openPicker(input);
                    });
                }
            }
        });
    }

    document.addEventListener('DOMContentLoaded', attachToInputs);
    // Re-scan dynamically added inputs
    const observer = new MutationObserver(() => attachToInputs());
    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
        attachToInputs();
    }

    window.GlobalDateTimePicker = {
        open: openPicker,
        close: closePicker
    };
})();
