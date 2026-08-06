import { supabase } from '../../js/supabase.js';

/* ============================================================
   QUEBRA-LOOP
   Conta redirecionamentos encadeados. Se estourar o limite,
   para tudo e mostra o motivo em vez de ficar em ping-pong.
   ============================================================ */

const LOOP_KEY = 'echoarena_admin_hops';
const LOOP_LIMIT = 3;

function getHops() {
  return parseInt(sessionStorage.getItem(LOOP_KEY) || '0', 10);
}

function clearHops() {
  sessionStorage.removeItem(LOOP_KEY);
}

function redirectTo(url) {
  const hops = getHops();

  if (hops >= LOOP_LIMIT) {
    clearHops();
    console.error(
      '[admin-auth] Loop de redirecionamento interrompido. ' +
      'Verifique a sessão e as permissões do perfil.'
    );
    document.documentElement.innerHTML =
      '<pre style="padding:2rem;font:14px/1.6 monospace;color:#ffb4bd;' +
      'background:#0b1221">Loop de autenticacao interrompido.\n\n' +
      'Abra o Console (F12) para ver o erro de origem.\n' +
      'Recarregue a pagina para tentar novamente.</pre>';
    throw new Error('LOOP_INTERROMPIDO');
  }

  sessionStorage.setItem(LOOP_KEY, String(hops + 1));
  location.replace(url);
}

/* ============================================================
   SESSÃO
   getSession() pode responder antes do cliente hidratar o token
   do localStorage. Quando vier vazio, aguardamos o evento de
   inicialização em vez de concluir "sem sessão".
   ============================================================ */

const HYDRATION_TIMEOUT_MS = 5000;

async function resolveSession() {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  if (data?.session?.user) {
    return data.session;
  }

  return new Promise((resolve) => {
    let settled = false;

    const finish = (session) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        listener?.subscription?.unsubscribe();
      } catch (_) {
        /* ignora */
      }
      resolve(session);
    };

    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (session?.user) {
          finish(session);
          return;
        }
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT') {
          finish(null);
        }
      }
    );

    const timer = setTimeout(() => finish(null), HYDRATION_TIMEOUT_MS);
  });
}

/* ============================================================
   PERFIL
   maybeSingle() devolve null em vez de lançar quando não há
   linha. O join com roles tem fallback: se a FK não existir ou
   o RLS bloquear, usa as colunas locais do próprio profiles.
   ============================================================ */

const PROFILE_FIELDS_BASE = 'id, username, display_name, role, role_id, is_admin';
const PROFILE_FIELDS_JOIN = `${PROFILE_FIELDS_BASE}, roles ( name )`;

async function getAdminProfile(userId) {
  if (!userId) {
    throw new Error('Usuário não identificado.');
  }

  let { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_FIELDS_JOIN)
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.warn(
      '[admin-auth] Join com roles indisponível, usando colunas locais.',
      error.message
    );

    const fallback = await supabase
      .from('profiles')
      .select(PROFILE_FIELDS_BASE)
      .eq('id', userId)
      .maybeSingle();

    if (fallback.error) {
      throw fallback.error;
    }

    data = fallback.data;
  }

  if (!data) {
    const err = new Error('Perfil não encontrado para este usuário.');
    err.code = 'PERFIL_AUSENTE';
    throw err;
  }

  return data;
}

/* Resolve o papel em cascata: join -> coluna role -> flag is_admin. */
function getRoleName(profile) {
  const roles = profile?.roles;

  const fromJoin = Array.isArray(roles)
    ? roles[0]?.name
    : roles?.name;

  if (fromJoin) return fromJoin;
  if (profile?.role) return profile.role;
  if (profile?.is_admin === true) return 'admin';

  return null;
}

/* ============================================================
   LOGIN
   ============================================================ */

export async function loginAdmin(email, password) {
  const normalizedEmail = String(email ?? '').trim();
  const normalizedPassword = String(password ?? '');

  if (!normalizedEmail || !normalizedPassword) {
    throw new Error('Informe o e-mail e a senha.');
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password: normalizedPassword
  });

  if (error) {
    throw error;
  }

  if (!data.user) {
    throw new Error('Não foi possível identificar o usuário.');
  }

  let profile;

  try {
    profile = await getAdminProfile(data.user.id);
  } catch (err) {
    /* Falha ao consultar o perfil não é o mesmo que não ser admin.
       Mantém a sessão e informa o motivo real. */
    console.error('[admin-auth] Erro ao carregar perfil:', err);
    throw new Error(
      'Login efetuado, mas não foi possível verificar as permissões. ' +
      'Tente novamente em instantes.'
    );
  }

  const roleName = getRoleName(profile);

  if (roleName !== 'admin') {
    await supabase.auth.signOut();
    throw new Error('Esta conta não possui acesso administrativo.');
  }

  clearHops();

  return { ...data, profile };
}

/* ============================================================
   GUARDA DO PAINEL
   ============================================================ */

export async function requireAdmin() {
  const session = await resolveSession();

  if (!session?.user) {
    redirectTo('./login.html');
    throw new Error('Sem sessão administrativa.');
  }

  let profile;

  try {
    profile = await getAdminProfile(session.user.id);
  } catch (err) {
    /* Erro de leitura: não desloga. Deslogar aqui é o que
       transformava falha de rede/RLS em loop infinito. */
    console.error('[admin-auth] Falha ao validar permissões:', err);

    if (err.code === 'PERFIL_AUSENTE') {
      await supabase.auth.signOut();
      redirectTo('./login.html');
    }

    throw err;
  }

  const roleName = getRoleName(profile);

  if (roleName !== 'admin') {
    await supabase.auth.signOut();
    redirectTo('./login.html');
    throw new Error('Esta conta não possui acesso administrativo.');
  }

  clearHops();

  return { session, profile, roleName };
}

/* ============================================================
   TELA DE LOGIN
   ============================================================ */

export async function redirectIfAdmin(destination = './index.html') {
  /* Se o quebra-loop já disparou, não redireciona:
     deixa a tela de login de pé para o usuário agir. */
  if (getHops() >= LOOP_LIMIT) {
    clearHops();
    return false;
  }

  let session;

  try {
    session = await resolveSession();
  } catch (err) {
    console.error('[admin-auth] Erro ao ler sessão:', err);
    return false;
  }

  if (!session?.user) {
    clearHops();
    return false;
  }

  try {
    const profile = await getAdminProfile(session.user.id);

    if (getRoleName(profile) === 'admin') {
      redirectTo(destination);
      return true;
    }
  } catch (err) {
    console.error('[admin-auth] Não foi possível verificar o administrador:', err);
  }

  clearHops();
  return false;
}

/* ============================================================
   LOGOUT
   ============================================================ */

export async function logoutAdmin() {
  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error('[admin-auth] Erro ao encerrar sessão:', error);
  }

  clearHops();
  location.replace('./login.html');
}

export { getAdminProfile, getRoleName };
