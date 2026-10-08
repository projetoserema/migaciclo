/* ==========================================================================
   MIGACICLO - APLICATIVO DE CICLO MENSTRUAL (INTEGRADO AO SUPABASE)
   ========================================================================== */

// Configuração das Credenciais do Supabase
const SUPABASE_URL = 'https://wbzndnjoyogissmdswmg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indiem5kbmpveW9naXNmd21nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NjE2ODIsImV4cCI6MjEwNzAzNzY4Mn0.oBIxPWfmLWVy_tZ3vw4F4hDaAhdiY5DA4zYe_UyZLTo';

// Inicialização do cliente Supabase via CDN window.supabase
const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const MigaCiclo = {
  // 1. ESTADO GLOBAL DA APLICAÇÃO
  state: {
    user: null,               // Dados da usuária { id, name, age, loggedWithGoogle }
    cycleInfo: null,          // { cycleDuration, periodDuration, lastPeriodDate }
    symptomsHistory: {},      // Objeto com chave 'AAAA-MM-DD' e valor com os sintomas
    currentScreen: 1,         // Tela atual (1 a 4)
    calendarDate: new Date(), // Data base para navegação no calendário
    selectedDateStr: null,    // Data selecionada no formato 'AAAA-MM-DD'
    tempSymptoms: { mood: '', energy: '', sleep: '', flow: '', cramps: '' }
  },
  authUser: null,

  setConnectionStatus(message, connected = false) {
    const status = document.getElementById('connection-status');
    if (!status) return;
    status.textContent = message;
    status.className = connected
      ? 'mb-4 text-xs text-green-700'
      : 'mb-4 text-xs text-amber-700';
  },

  async initializeAuth() {
    if (!supabaseClient) {
      throw new Error('SDK do Supabase não carregou. Verifique sua conexão com a internet.');
    }

    const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError) throw sessionError;

    if (sessionData.session) {
      this.authUser = sessionData.session.user;
      return;
    }

    const { data, error } = await supabaseClient.auth.signInAnonymously();
    if (error) throw error;
    this.authUser = data.user;
  },

  // 2. INICIALIZAÇÃO DO APLICATIVO
  async init() {
    this.createSVGGradient();
    try {
      await this.initializeAuth();
      this.setConnectionStatus('Conectado ao banco de dados.', true);
    } catch (err) {
      this.setConnectionStatus('Banco indisponível. Os dados serão mantidos neste dispositivo.');
      console.error('Erro ao conectar ao Supabase:', err);
    }
    await this.loadData();
    if (this.authUser && this.state.user) await this.saveState();
    this.setupSymptomButtons();
    
    // Verifica se a usuária já se cadastrou previamente
    if (this.state.user) {
      if (this.state.cycleInfo) {
        this.navigateToScreen(3);
      } else {
        this.navigateToScreen(2);
      }
    } else {
      this.navigateToScreen(1);
    }

    // Inicializa sintetizador de voz do navegador
    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
      };
    }
  },

  // 3. CRIAÇÃO DO GRADIENTE DA BORBOLETA MIGA
  createSVGGradient() {
    const svg = document.querySelector('.svg-butterfly');
    if (!svg) return;
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <linearGradient id="goldPurpleGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#f1c40f" />
        <stop offset="50%" stop-color="#ab47bc" />
        <stop offset="100%" stop-color="#6c3483" />
      </linearGradient>
    `;
    svg.appendChild(defs);
  },

  // 4. PERSISTÊNCIA DE DADOS (SUPABASE + LOCALSTORAGE FALLBACK)
  async loadData() {
    // 1. Carrega do LocalStorage primeiro para resposta rápida
    try {
      const localUser = localStorage.getItem('migaciclo_user');
      const localCycle = localStorage.getItem('migaciclo_cycle');
      const localSymptoms = localStorage.getItem('migaciclo_symptoms');

      if (localUser) this.state.user = JSON.parse(localUser);
      if (localCycle) this.state.cycleInfo = JSON.parse(localCycle);
      if (localSymptoms) this.state.symptomsHistory = JSON.parse(localSymptoms);
    } catch (e) {
      console.error('Erro ao carregar dados locais:', e);
    }

    // 2. Tenta sincronizar/buscar dados atualizados no Supabase
    if (supabaseClient && this.authUser && this.state.user) {
      this.state.user.id = this.authUser.id;
      try {
        // Busca Perfil & Ciclo
        const { data: profile, error: profileError } = await supabaseClient
          .from('profiles')
          .select('*')
          .eq('id', this.authUser.id)
          .maybeSingle();

        if (profileError) throw profileError;

        if (profile) {
          this.state.user = { id: profile.id, name: profile.name, age: profile.age, loggedWithGoogle: profile.logged_with_google };
          if (profile.cycle_duration && profile.period_duration && profile.last_period_date) {
            this.state.cycleInfo = {
              cycleDuration: profile.cycle_duration,
              periodDuration: profile.period_duration,
              lastPeriodDate: profile.last_period_date
            };
          }
        }

        // Busca Sintomas
        const { data: symptoms, error: symptomsError } = await supabaseClient
          .from('symptoms')
          .select('*')
          .eq('user_id', this.authUser.id);

        if (symptomsError) throw symptomsError;

        if (symptoms && symptoms.length > 0) {
          const historyMap = {};
          symptoms.forEach(item => {
            historyMap[item.date] = {
              mood: item.mood || '',
              energy: item.energy || '',
              sleep: item.sleep || '',
              flow: item.flow || '',
              cramps: item.cramps || '',
              notes: item.notes || ''
            };
          });
          this.state.symptomsHistory = historyMap;
        }
      } catch (err) {
        this.setConnectionStatus('Não foi possível acessar as tabelas do Supabase. Confira as credenciais e o SQL de configuração.');
        console.warn('Conexão com Supabase indisponível ou tabelas não configuradas. Mantendo cache local.', err);
      }
    }
  },

  async saveState() {
    // Salva Localmente
    if (this.state.user) {
      localStorage.setItem('migaciclo_user', JSON.stringify(this.state.user));
    }
    if (this.state.cycleInfo) {
      localStorage.setItem('migaciclo_cycle', JSON.stringify(this.state.cycleInfo));
    }
    if (this.state.symptomsHistory) {
      localStorage.setItem('migaciclo_symptoms', JSON.stringify(this.state.symptomsHistory));
    }

    // Sincroniza com o Supabase
    if (supabaseClient && this.authUser && this.state.user) {
      try {
        const { error } = await supabaseClient.from('profiles').upsert({
          id: this.authUser.id,
          name: this.state.user.name,
          age: Number(this.state.user.age),
          logged_with_google: this.state.user.loggedWithGoogle,
          cycle_duration: this.state.cycleInfo ? this.state.cycleInfo.cycleDuration : null,
          period_duration: this.state.cycleInfo ? this.state.cycleInfo.periodDuration : null,
          last_period_date: this.state.cycleInfo ? this.state.cycleInfo.lastPeriodDate : null
        });
        if (error) throw error;
        this.setConnectionStatus('Dados sincronizados com o banco.', true);
      } catch (err) {
        this.setConnectionStatus('Falha ao sincronizar. Os dados continuam salvos neste dispositivo.');
        console.error('Erro ao salvar dados no Supabase:', err);
      }
    }
  },

  async resetData() {
    if (confirm("Deseja mesmo reiniciar seus dados do MigaCiclo?")) {
      if (supabaseClient && this.state.user && this.state.user.id) {
        try {
          await supabaseClient.from('symptoms').delete().eq('user_id', this.state.user.id);
          await supabaseClient.from('profiles').delete().eq('id', this.state.user.id);
        } catch (e) {
          console.error('Erro ao deletar registros no Supabase:', e);
        }
      }
      localStorage.clear();
      location.reload();
    }
  },

  // 5. SÍNTESE DE VOZ FEMININA DA ASSISTENTE MIGA
  speakText(text) {
    if (!('speechSynthesis' in window)) return;

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    utterance.rate = 0.95;
    utterance.pitch = 1.25;

    const voices = window.speechSynthesis.getVoices();
    const femaleVoice = voices.find(v => 
      v.lang.includes('pt') && 
      (v.name.includes('Maria') || v.name.includes('Francisca') || v.name.includes('Helena') || v.name.includes('Luciana') || v.name.includes('Google'))
    ) || voices.find(v => v.lang.includes('pt'));

    if (femaleVoice) utterance.voice = femaleVoice;

    window.speechSynthesis.speak(utterance);
  },

  // 6. GERENCIAMENTO E NAVEGAÇÃO DE TELAS
  navigateToScreen(screenNum) {
    this.state.currentScreen = screenNum;
    
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(`screen-${screenNum}`);
    if (target) target.classList.add('active');

    const userPill = document.getElementById('user-pill');
    const headerName = document.getElementById('header-user-name');
    if (this.state.user && this.state.user.name) {
      if (userPill) userPill.style.display = 'flex';
      if (headerName) headerName.textContent = this.state.user.name;
    } else {
      if (userPill) userPill.style.display = 'none';
    }

    if (screenNum === 3) {
      this.renderCalendar();
    } else if (screenNum === 4) {
      this.setupScreen4();
    }
  },

  // 7. TELA 1: CADASTRO E LOGIN GOOGLE
  // 7. TELA 1: CADASTRO E LOGIN GOOGLE (CORRIGIDO)
  async handleScreen1Submit(e) {
    // 1. Impede estritamente o recarregamento da página (Submit Padrão do HTML)
    if (e && e.preventDefault) {
      e.preventDefault();
    }

    try {
      const nameEl = document.getElementById('user-name');
      const ageEl = document.getElementById('user-age');

      const name = nameEl ? nameEl.value.trim() : '';
      const age = ageEl ? ageEl.value : '';

      if (!name || !age) {
        alert("Por favor, preencha seu nome e sua idade.");
        return;
      }

      const userId = this.authUser?.id || this.state.user?.id || 'usr_' + Date.now();
      this.state.user = { id: userId, name, age, loggedWithGoogle: false };
      
      // Salva os dados
      await this.saveState();
      
      // Tenta falar com a assistente, ignorando caso o navegador bloqueie
      try {
        this.speakText(`Seja bem-vinda, ${name}! Agora me conte mais sobre seu ciclo.`);
      } catch (voiceErr) {
        console.warn("Aviso na voz Miga:", voiceErr);
      }

      // Avança para a Tela 2
      this.navigateToScreen(2);
    } catch (err) {
      console.error("Erro ao processar formulário da Tela 1:", err);
    }
  },
  async handleGoogleLogin() {
    if (supabaseClient) {
      try {
        const { error } = await supabaseClient.auth.signInWithOAuth({
          provider: 'google'
        });
        if (error) throw error;
        return;
      } catch (err) {
        console.error('Erro de autenticação Google:', err);
        alert('Não foi possível entrar com Google. Verifique a configuração de autenticação no Supabase.');
        return;
      }
    }

    alert('O cliente do Supabase não está disponível.');
  },

  // 8. TELA 2: CONFIGURAÇÃO DO CICLO
  async handleScreen2Submit(e) {
    e.preventDefault();
    const cycleInput = document.getElementById('cycle-duration');
    const periodInput = document.getElementById('period-duration');
    const lastPeriodInput = document.getElementById('last-period-date');

    const cycleDuration = cycleInput ? parseInt(cycleInput.value) : 28;
    const periodDuration = periodInput ? parseInt(periodInput.value) : 5;
    const lastPeriodDate = lastPeriodInput ? lastPeriodInput.value : '';

    if (!lastPeriodDate) {
      alert("Por favor, selecione a data da última menstruação.");
      return;
    }

    this.state.cycleInfo = { cycleDuration, periodDuration, lastPeriodDate };
    await this.saveState();

    this.speakText("Prontinho! Seu calendário foi gerado com sucesso.");
    this.navigateToScreen(3);
  },

  // 9. TELA 3: CÁLCULOS E RENDERIZAÇÃO DO CALENDÁRIO MENSTRUAL
  renderCalendar() {
    if (!this.state.cycleInfo) return;

    const { cycleDuration, periodDuration, lastPeriodDate } = this.state.cycleInfo;
    const year = this.state.calendarDate.getFullYear();
    const month = this.state.calendarDate.getMonth();

    const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    const monthYearEl = document.getElementById('calendar-month-year');
    if (monthYearEl) monthYearEl.textContent = `${monthNames[month]} ${year}`;

    const grid = document.getElementById('calendar-days');
    if (!grid) return;
    grid.innerHTML = '';

    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < firstDayIndex; i++) {
      const emptyCell = document.createElement('div');
      emptyCell.className = 'cal-day empty';
      grid.appendChild(emptyCell);
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const lastPeriod = new Date(lastPeriodDate + 'T00:00:00');

    for (let day = 1; day <= daysInMonth; day++) {
      const cellDate = new Date(year, month, day);
      const dateStr = cellDate.toISOString().split('T')[0];

      const dayCell = document.createElement('div');
      dayCell.className = 'cal-day';
      dayCell.textContent = day;

      if (dateStr === todayStr) dayCell.classList.add('today');

      const diffTime = cellDate.getTime() - lastPeriod.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 3600 * 24));
      const cycleDay = ((diffDays % cycleDuration) + cycleDuration) % cycleDuration;

      const estimatedOvulationDay = cycleDuration - 14;

      if (cycleDay >= 0 && cycleDay < periodDuration) {
        dayCell.classList.add('period');
      } else if (cycleDay === estimatedOvulationDay) {
        dayCell.classList.add('ovulation');
      } else if (cycleDay >= estimatedOvulationDay - 3 && cycleDay <= estimatedOvulationDay + 2) {
        dayCell.classList.add('fertile');
      }

      dayCell.onclick = () => this.selectCalendarDay(dateStr, cycleDay, periodDuration, estimatedOvulationDay);

      grid.appendChild(dayCell);
    }

    // Seleciona por padrão o dia atual ou a data selecionada
    const defaultDate = this.state.selectedDateStr || todayStr;
    const defaultCellDate = new Date(defaultDate + 'T00:00:00');
    const diffTime = defaultCellDate.getTime() - lastPeriod.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 3600 * 24));
    const cycleDay = ((diffDays % cycleDuration) + cycleDuration) % cycleDuration;

    this.selectCalendarDay(defaultDate, cycleDay, periodDuration, cycleDuration - 14);
  },

  changeMonth(direction) {
    this.state.calendarDate.setMonth(this.state.calendarDate.getMonth() + direction);
    this.renderCalendar();
  },

  selectCalendarDay(dateStr, cycleDay, periodDuration, ovulationDay) {
    this.state.selectedDateStr = dateStr;

    document.querySelectorAll('.cal-day').forEach(cell => cell.classList.remove('selected'));
    
    const phaseTitle = document.getElementById('cycle-phase-title');
    const phaseDesc = document.getElementById('cycle-phase-desc');

    if (phaseTitle && phaseDesc) {
      if (cycleDay >= 0 && cycleDay < periodDuration) {
        phaseTitle.textContent = "Fase Menstrual 🩸";
        phaseDesc.textContent = "Seu corpo está renovando o endométrio. Descanse bastante e hidrate-se!";
      } else if (cycleDay === ovulationDay) {
        phaseTitle.textContent = "Dia da Ovulação 🌟";
        phaseDesc.textContent = "Pico de fertilidade! Sua energia e disposição tendem a estar no máximo.";
      } else if (cycleDay >= ovulationDay - 3 && cycleDay <= ovulationDay + 2) {
        phaseTitle.textContent = "Janela Fértil 💜";
        phaseDesc.textContent = "Alta probabilidade de concepção. Acompanhe as mudanças no seu corpo.";
      } else if (cycleDay > ovulationDay) {
        phaseTitle.textContent = "Fase Lútea 🌙";
        phaseDesc.textContent = "Período pré-menstrual (TPM). Priorize hábitos relaxantes e boa alimentação.";
      } else {
        phaseTitle.textContent = "Fase Folicular ✨";
        phaseDesc.textContent = "Níveis de estrogênio subindo! Momento ideal para planejar projetos e treinar.";
      }
    }

    const history = this.state.symptomsHistory[dateStr];
    
    const setStatText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value && value !== '' ? value : '-';
    };

    setStatText('stat-flux', history?.flow);
    setStatText('stat-mood', history?.mood);
    setStatText('stat-energy', history?.energy);
    setStatText('stat-cramps', history?.cramps);
  },

  // 10. TELA 4: REGISTRO E RELATÓRIO DE SINTOMAS
  setupSymptomButtons() {
    document.querySelectorAll('.options-grid').forEach(grid => {
      const group = grid.getAttribute('data-group');
      grid.querySelectorAll('.opt-btn').forEach(btn => {
        btn.onclick = () => {
          grid.querySelectorAll('.opt-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          this.state.tempSymptoms[group] = btn.getAttribute('data-val');
        };
      });
    });
  },

  setupScreen4() {
    const dateStr = this.state.selectedDateStr || new Date().toISOString().split('T')[0];
    const reportDateEl = document.getElementById('report-date-display');
    if (reportDateEl) reportDateEl.textContent = `Data Selecionada: ${dateStr}`;

    this.state.tempSymptoms = { mood: '', energy: '', sleep: '', flow: '', cramps: '' };
    document.querySelectorAll('.opt-btn').forEach(b => b.classList.remove('selected'));
    
    const notesEl = document.getElementById('diary-notes');
    if (notesEl) notesEl.value = '';

    const existing = this.state.symptomsHistory[dateStr];
    if (existing) {
      Object.keys(existing).forEach(group => {
        if (group === 'notes') {
          if (notesEl) notesEl.value = existing.notes || '';
        } else {
          const val = existing[group];
          if (val) {
            const btn = document.querySelector(`.options-grid[data-group="${group}"] .opt-btn[data-val="${val}"]`);
            if (btn) {
              btn.classList.add('selected');
              this.state.tempSymptoms[group] = val;
            }
          }
        }
      });
    }

    this.renderHistoryList();
  },

  async handleScreen4Submit(e) {
    e.preventDefault();
    const dateStr = this.state.selectedDateStr || new Date().toISOString().split('T')[0];
    const notesEl = document.getElementById('diary-notes');
    const notes = notesEl ? notesEl.value.trim() : '';

    const symptomEntry = {
      ...this.state.tempSymptoms,
      notes
    };

    this.state.symptomsHistory[dateStr] = symptomEntry;

    // Salva na tabela 'symptoms' do Supabase
    if (supabaseClient && this.authUser && this.state.user) {
      try {
        const { error } = await supabaseClient.from('symptoms').upsert({
          user_id: this.authUser.id,
          date: dateStr,
          mood: symptomEntry.mood,
          energy: symptomEntry.energy,
          sleep: symptomEntry.sleep,
          flow: symptomEntry.flow,
          cramps: symptomEntry.cramps,
          notes: symptomEntry.notes
        }, { onConflict: 'user_id,date' });
        if (error) throw error;
      } catch (err) {
        this.setConnectionStatus('Falha ao sincronizar sintomas. O registro ficou salvo neste dispositivo.');
        console.error('Erro ao salvar sintoma no Supabase:', err);
      }
    }

    await this.saveState();
    this.speakText("Anotado com sucesso! Seus sintomas foram salvos no seu relatório.");
    alert("Sintomas salvos com sucesso!");
    this.navigateToScreen(3);
  },

  renderHistoryList() {
    const historyList = document.getElementById('history-list');
    if (!historyList) return;
    historyList.innerHTML = '';

    const dates = Object.keys(this.state.symptomsHistory).sort().reverse();
    if (dates.length === 0) {
      historyList.innerHTML = '<p style="font-size:12px; color:#888;">Nenhum registro antigo ainda.</p>';
      return;
    }

    dates.forEach(date => {
      const item = this.state.symptomsHistory[date];
      const card = document.createElement('div');
      card.className = 'history-card';
      card.innerHTML = `
        <div class="history-date">📅 ${date}</div>
        <div><strong>Humor:</strong> ${item.mood || '-'} | <strong>Fluxo:</strong> ${item.flow || '-'}</div>
        <div><strong>Cólica:</strong> ${item.cramps || '-'} | <strong>Energia:</strong> ${item.energy || '-'}</div>
        ${item.notes ? `<div style="margin-top:4px; font-style:italic; color:#555;">"${item.notes}"</div>` : ''}
      `;
      historyList.appendChild(card);
    });
  },

  // 11. DICAS INTERATIVAS DA ASSISTENTE MIGA
  triggerMigaInteractiveTip() {
    const tips = [
      "Beba bastante água durante a sua menstruação para aliviar o inchaço! 💧",
      "Exercícios leves, como caminhada ou yoga, ajudam muito nas cólicas! 🧘‍♀️",
      "Não se esqueça de descansar quando sentir que sua energia está baixa. 💖",
      "Estou sempre aqui para te guiar no seu ciclo menstrual! 🦋"
    ];
    const randomTip = tips[Math.floor(Math.random() * tips.length)];
    this.speakText(randomTip);
    alert(`🦋 Miga diz:\n\n"${randomTip}"`);
  }
};

// Dispara a inicialização quando o DOM estiver pronto
window.addEventListener('DOMContentLoaded', () => {
  MigaCiclo.init();
});