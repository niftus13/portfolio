<script setup lang="ts">
interface Member {
  id: string;
  email: string;
  displayName: string;
  role: "owner" | "admin" | "editor" | "viewer";
  status: "active" | "inactive";
}

const props = defineProps<{ slug: string }>();
const members = ref<Member[]>([]);
const selected = ref("");
const role = ref<"admin" | "editor" | "viewer">("viewer");
const status = ref<"active" | "inactive">("active");
const busy = ref(false);
const loaded = ref(false);
const error = ref("");
const message = ref("");
const base = computed(
  () => `/api/v1/orgs/${encodeURIComponent(props.slug)}/members`,
);

watch(
  () => props.slug,
  () => {
    members.value = [];
    selected.value = "";
    loaded.value = false;
    error.value = "";
    message.value = "";
  },
);

watch(selected, (id) => {
  const member = members.value.find((item) => item.id === id);
  if (member && member.role !== "owner") {
    role.value = member.role;
    status.value = member.status;
  }
});

async function load() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    members.value = (await $fetch<{ members: Member[] }>(base.value)).members;
    loaded.value = true;
  } catch {
    error.value =
      "멤버 목록을 불러오지 못했습니다. 권한과 로그인 상태를 확인해 주세요.";
  } finally {
    busy.value = false;
  }
}

async function save() {
  if (busy.value || !selected.value) return;
  busy.value = true;
  error.value = "";
  message.value = "";
  try {
    const token = (await $fetch<{ csrfToken: string }>("/api/v1/csrf-token"))
      .csrfToken;
    const result = await $fetch<{ member: Member }>(
      `${base.value}/${selected.value}`,
      {
        method: "PATCH",
        headers: { "X-CSRF-Token": token },
        body: { role: role.value, status: status.value },
      },
    );
    members.value = members.value.map((member) =>
      member.id === result.member.id ? result.member : member,
    );
    message.value =
      "멤버 상태를 저장했습니다. 다음 요청부터 권한이 적용됩니다.";
  } catch {
    error.value =
      "멤버를 변경하지 못했습니다. 역할, 데모 제한 및 로그인 상태를 확인해 주세요.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="panel member-panel">
    <p class="eyebrow">ACCESS</p>
    <h2>멤버 관리</h2>
    <button type="button" :disabled="busy" @click="load">멤버 불러오기</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="message" role="status">{{ message }}</p>
    <p v-if="loaded && !members.length">멤버가 없습니다.</p>
    <form
      v-if="members.length"
      class="stack-form member-form"
      @submit.prevent="save"
    >
      <label for="member-select">멤버</label>
      <select id="member-select" v-model="selected" :disabled="busy">
        <option value="">선택</option>
        <option
          v-for="member in members"
          :key="member.id"
          :value="member.id"
          :disabled="member.role === 'owner'"
        >
          {{ member.displayName }} ({{ member.email }}) · {{ member.role }} ·
          {{ member.status }}
        </option>
      </select>
      <label for="member-role">역할</label>
      <select id="member-role" v-model="role" :disabled="busy || !selected">
        <option value="admin">admin</option>
        <option value="editor">editor</option>
        <option value="viewer">viewer</option>
      </select>
      <label for="member-status">상태</label>
      <select id="member-status" v-model="status" :disabled="busy || !selected">
        <option value="active">활성</option>
        <option value="inactive">비활성</option>
      </select>
      <button type="submit" :disabled="busy || !selected">멤버 저장</button>
    </form>
  </section>
</template>
