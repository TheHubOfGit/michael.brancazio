(function (root) {
    'use strict';

    // Preferences are optional. A blocked storage API must never break the page.
    const preferences = new Map();
    const storage = {
        get(key) {
            if (preferences.has(key)) return preferences.get(key);
            try { return root.localStorage.getItem(key); } catch { return null; }
        },
        set(key, value) {
            preferences.set(key, String(value));
            try { root.localStorage.setItem(key, String(value)); } catch { /* Session preference still works. */ }
        }
    };

    const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);

    // Deliberately small Markdown dialect: raw HTML and links are never interpreted.
    function inlineMarkdown(value) {
        return value.split(/(`[^`\n]+`)/g).map((part) => {
            if (part.startsWith('`') && part.endsWith('`')) {
                return `<code class="inline-code">${escapeHTML(part.slice(1, -1))}</code>`;
            }
            return escapeHTML(part)
                .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, stars, underscores) => `<strong>${stars || underscores}</strong>`)
                .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s.,!?;)])/g, '$1<em>$2</em>');
        }).join('');
    }

    function renderMarkdown(value) {
        const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n');
        const output = [];
        const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
        const separator = (line) => line.includes('|') && cells(line).every((cell) => /^:?-{3,}:?$/.test(cell));
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (/^\s*```/.test(line)) {
                const code = [];
                while (++i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i]);
                output.push(`<pre class="code-block"><code>${escapeHTML(code.join('\n'))}</code></pre>`);
            } else if (line.includes('|') && i + 1 < lines.length && separator(lines[i + 1])) {
                const header = cells(line);
                i += 2;
                const rows = [];
                while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
                    const row = cells(lines[i++]);
                    rows.push(`<tr>${header.map((_, column) => `<td>${inlineMarkdown(row[column] || '')}</td>`).join('')}</tr>`);
                }
                i--;
                output.push(`<div class="chat-table-scroll"><table class="chat-table"><thead><tr>${header.map((cell) => `<th scope="col">${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`);
            } else if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) {
                const ordered = /^\s*\d+\./.test(line);
                const pattern = ordered ? /^\s*\d+\.\s+(.*)$/ : /^\s*[-*]\s+(.*)$/;
                const items = [];
                while (i < lines.length && pattern.test(lines[i])) items.push(`<li>${inlineMarkdown(lines[i++].match(pattern)[1])}</li>`);
                i--;
                const tag = ordered ? 'ol' : 'ul';
                output.push(`<${tag} class="chat-list">${items.join('')}</${tag}>`);
            } else if (/^#{1,3}\s+/.test(line)) {
                output.push(`<p><strong>${inlineMarkdown(line.replace(/^#{1,3}\s+/, ''))}</strong></p>`);
            } else if (line.trim()) {
                output.push(`<p>${inlineMarkdown(line)}</p>`);
            }
        }
        return output.join('');
    }

    function createChatBody(details, profile, history) {
        let portfolio = profile;
        const recent = history.slice();
        const encoder = new TextEncoder();
        // The context string is assembled exactly as the pre-refactor page built it.
        // Leave room below the server's 64 KiB ceiling for non-ASCII text and
        // JSON escaping. Discard older turns first, always preserving the question.
        while (true) {
            let context = portfolio;
            if (recent.length) {
                context += '\n\nCONVERSATION HISTORY:\n';
                recent.forEach((message, index) => {
                    context += `${index + 1}. ${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}\n`;
                });
            }
            context += `\n\nCurrent user question: ${details.message}\n\nProvide a professional, concise response:`;
            const body = JSON.stringify({ ...details, context });
            if (encoder.encode(body).byteLength <= 60000) return body;
            if (recent.length) recent.shift();
            else if (portfolio.length) portfolio = portfolio.slice(0, Math.floor(portfolio.length * 0.8));
            else throw new Error('Your question is too large. Please shorten it and try again.');
        }
    }

    const reduceMotion = () => root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scrollBehavior = () => reduceMotion() ? 'instant' : 'smooth';
    let activeModal = null;
    function openModal(modal, onClose) {
        if (activeModal?.element === modal) return;
        if (activeModal) closeModal(activeModal.element);
        const doc = root.document;
        const siblings = Array.from(doc.body.children).filter((element) => element !== modal && !['SCRIPT', 'STYLE'].includes(element.tagName));
        activeModal = { element: modal, previousFocus: doc.activeElement, overflow: doc.body.style.overflow,
            siblings: siblings.map((element) => [element, element.inert]), onClose };
        siblings.forEach((element) => { element.inert = true; });
        doc.body.style.overflow = 'hidden';
        modal.setAttribute('aria-hidden', 'false');
        modal.style.display = 'block';
        modal.classList.add('visible');
        const frame = modal.querySelector('iframe[data-src]');
        if (frame) frame.src = frame.dataset.src;
        (modal.querySelector('button, input, textarea, [tabindex="0"]') || modal).focus();
    }
    function closeModal(modal) {
        if (!activeModal || activeModal.element !== modal) return;
        const state = activeModal;
        activeModal = null;
        modal.classList.remove('visible');
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
        const frame = modal.querySelector('iframe[data-src]');
        if (frame) frame.src = 'about:blank';
        state.siblings.forEach(([element, inert]) => { element.inert = inert; });
        root.document.body.style.overflow = state.overflow;
        state.onClose?.();
        if (state.previousFocus?.isConnected) state.previousFocus.focus();
    }

    root.Portfolio = { storage, renderMarkdown, createChatBody, escapeHTML, reduceMotion, scrollBehavior, openModal, closeModal };
    if (!root.document) return;
    root.document.addEventListener('keydown', (event) => {
        if (!activeModal) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            closeModal(activeModal.element);
        } else if (event.key === 'Tab') {
            const focusable = Array.from(activeModal.element.querySelectorAll('a[href], button, input, textarea, iframe, [tabindex="0"]'))
                .filter((element) => !element.disabled && element.getClientRects().length);
            const first = focusable[0];
            const last = focusable.at(-1);
            if (!first) { event.preventDefault(); return; }
            if (event.shiftKey && root.document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && root.document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    });
    root.document.addEventListener('DOMContentLoaded', () => {
        root.document.querySelectorAll('.card-scrollable-content').forEach(element => {
            element.tabIndex = 0;
            element.setAttribute('role', 'region');
            element.setAttribute('aria-label', element.querySelector('.experience-title, .card-section-title')?.textContent.trim() || 'Portfolio details');
        });
        root.document.querySelectorAll('.horizontal-scroll-container').forEach((container) => {
            container.tabIndex = 0;
            container.setAttribute('role', 'region');
            container.setAttribute('aria-label', container.closest('.scroll-wrapper')?.previousElementSibling?.textContent.trim() || 'Portfolio cards');
        });
    });
})(globalThis);
