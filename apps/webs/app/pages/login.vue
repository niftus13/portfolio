<script setup lang="ts">
interface User {
  id: string;
  email: string;
  displayName: string;
}

interface AuthResponse {
  user: User;
  hasOrganizations: boolean;
}

const user = ref<User | null>(null);
const hasOrganizations = ref(false);
const email = ref("");
const password = ref("");
const displayName = ref("");
const mode = ref<"login" | "signup">("login");
const loading = ref(true);
const submitting = ref(false);
const message = ref("");
const errorMessage = ref("");

function statusOf(error: unknown): number | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
  ) {
    return error.statusCode;
  }
  return undefined;
}

async function csrf(): Promise<string> {
  const response = await $fetch<{ csrfToken: string }>("/api/v1/csrf-token");
  return response.csrfToken;
}

onMounted(async () => {
  try {
    const response = await $fetch<AuthResponse>("/api/v1/auth/me");
    user.value = response.user;
    hasOrganizations.value = response.hasOrganizations;
  } catch (error) {
    if (statusOf(error) !== 401) {
      errorMessage.value =
        "인증 상태를 확인하지 못했습니다. 새로고침해 다시 시도해 주세요.";
    }
  } finally {
    loading.value = false;
  }
});

async function submit() {
  if (submitting.value) return;
  submitting.value = true;
  errorMessage.value = "";
  message.value = "";
  try {
    const token = await csrf();
    if (mode.value === "signup") {
      await $fetch("/api/v1/auth/signup", {
        method: "POST",
        headers: { "X-CSRF-Token": token },
        body: {
          email: email.value,
          password: password.value,
          displayName: displayName.value,
        },
      });
      password.value = "";
      mode.value = "login";
      message.value = "가입이 완료됐습니다. 로그인해 주세요.";
    } else {
      const response = await $fetch<AuthResponse>("/api/v1/auth/login", {
        method: "POST",
        headers: { "X-CSRF-Token": token },
        body: { email: email.value, password: password.value },
      });
      user.value = response.user;
      hasOrganizations.value = response.hasOrganizations;
      password.value = "";
    }
  } catch (error) {
    const status = statusOf(error);
    errorMessage.value =
      status === 401
        ? "이메일 또는 비밀번호를 확인해 주세요."
        : status === 409
          ? "이미 가입된 이메일이거나 로그인 상태입니다."
          : status === 429
            ? "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."
            : status === 400
              ? "입력값을 확인해 주세요."
              : "요청을 처리하지 못했습니다. 다시 시도해 주세요.";
  } finally {
    submitting.value = false;
  }
}

async function logout() {
  if (submitting.value) return;
  submitting.value = true;
  errorMessage.value = "";
  try {
    await $fetch("/api/v1/auth/logout", {
      method: "POST",
      headers: { "X-CSRF-Token": await csrf() },
    });
    user.value = null;
    message.value = "로그아웃했습니다.";
  } catch (error) {
    if (statusOf(error) === 401) {
      user.value = null;
      message.value = "세션이 만료됐습니다. 다시 로그인해 주세요.";
    } else {
      errorMessage.value = "로그아웃하지 못했습니다. 다시 시도해 주세요.";
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<!-- eslint-disable vue/html-self-closing -- Prettier formats void tags as self-closing. -->
<template>
  <main>
    <h1>계정</h1>
    <NuxtLink to="/">서비스 상태</NuxtLink>
    <p v-if="loading">인증 상태를 확인하고 있습니다…</p>
    <template v-else>
      <p v-if="message" role="status">{{ message }}</p>
      <p v-if="errorMessage" role="alert">{{ errorMessage }}</p>
      <section v-if="user">
        <h2>{{ user.displayName }}님, 환영합니다</h2>
        <p v-if="hasOrganizations">
          <NuxtLink to="/documents">조직과 문서 보기</NuxtLink>
        </p>
        <p v-else>
          소속된 조직이 없습니다. 문서 기능을 체험하려면 데모 계정을 이용해
          주세요.
        </p>
        <button type="button" :disabled="submitting" @click="logout">
          로그아웃
        </button>
      </section>
      <section v-else>
        <h2>{{ mode === "login" ? "로그인" : "회원가입" }}</h2>
        <form @submit.prevent="submit">
          <label for="auth-email">이메일</label>
          <input
            id="auth-email"
            v-model="email"
            type="text"
            inputmode="email"
            autocomplete="username"
            required
          />
          <label v-if="mode === 'signup'" for="auth-name">이름</label>
          <input
            v-if="mode === 'signup'"
            id="auth-name"
            v-model="displayName"
            autocomplete="name"
            required
          />
          <label for="auth-password">비밀번호</label>
          <input
            id="auth-password"
            v-model="password"
            type="password"
            :autocomplete="
              mode === 'login' ? 'current-password' : 'new-password'
            "
            required
          />
          <p>비밀번호는 12~128자로 입력해 주세요.</p>
          <button type="submit" :disabled="submitting">
            {{ submitting ? "처리 중…" : mode === "login" ? "로그인" : "가입" }}
          </button>
        </form>
        <button
          type="button"
          :disabled="submitting"
          @click="
            mode = mode === 'login' ? 'signup' : 'login';
            errorMessage = '';
            message = '';
          "
        >
          {{ mode === "login" ? "회원가입" : "로그인으로 돌아가기" }}
        </button>
      </section>
    </template>
  </main>
</template>
