<script setup lang="ts">
interface Organization {
  slug: string;
  name: string;
  role: "owner" | "admin" | "editor" | "viewer";
}
interface Document {
  id: string;
  title: string;
  contentMd: string;
  categoryId: string | null;
  contentVersion: string;
  revision: string;
  createdAt: string;
  updatedAt: string;
}
interface Version {
  version: string;
  title: string;
  contentMd: string;
  changeType: string;
  createdAt: string;
}

const organizations = ref<Organization[]>([]);
const selected = ref<Organization | null>(null);
const documents = ref<Document[]>([]);
const current = ref<Document | null>(null);
const versions = ref<Version[]>([]);
const title = ref("");
const content = ref("");
const creating = ref(false);
const loading = ref(true);
const busy = ref(false);
const errorMessage = ref("");
const message = ref("");
const conflict = ref(false);
const canWrite = computed(
  () => selected.value?.role !== "viewer" && selected.value !== null,
);
const base = computed(
  () =>
    `/api/v1/orgs/${encodeURIComponent(selected.value?.slug ?? "")}/documents`,
);

function statusOf(error: unknown): number | undefined {
  return typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
    ? error.statusCode
    : undefined;
}

function report(error: unknown) {
  errorMessage.value =
    statusOf(error) === 401
      ? "세션이 만료됐습니다. 계정 화면에서 다시 로그인해 주세요."
      : statusOf(error) === 403
        ? "이 작업을 수행할 권한이 없습니다."
        : statusOf(error) === 404
          ? "조직 또는 문서를 찾을 수 없습니다. 목록을 다시 확인해 주세요."
          : statusOf(error) === 400
            ? "입력값을 확인해 주세요."
            : "요청을 처리하지 못했습니다. 다시 시도해 주세요.";
}

async function loadOrganizations() {
  loading.value = true;
  errorMessage.value = "";
  try {
    organizations.value = (
      await $fetch<{ organizations: Organization[] }>("/api/v1/orgs")
    ).organizations;
  } catch (error) {
    report(error);
  } finally {
    loading.value = false;
  }
}
onMounted(loadOrganizations);

async function selectOrganization(organization: Organization) {
  if (busy.value) return;
  selected.value = organization;
  current.value = null;
  creating.value = false;
  documents.value = [];
  versions.value = [];
  errorMessage.value = "";
  message.value = "";
  busy.value = true;
  try {
    documents.value = (
      await $fetch<{ documents: Document[] }>(base.value)
    ).documents;
  } catch (error) {
    report(error);
  } finally {
    busy.value = false;
  }
}

async function openDocument(id: string) {
  if (busy.value) return;
  busy.value = true;
  errorMessage.value = "";
  message.value = "";
  try {
    const [detail, history] = await Promise.all([
      $fetch<{ document: Document }>(`${base.value}/${id}`),
      $fetch<{ versions: Version[] }>(`${base.value}/${id}/versions`),
    ]);
    current.value = detail.document;
    title.value = detail.document.title;
    content.value = detail.document.contentMd;
    versions.value = history.versions;
    creating.value = false;
    conflict.value = false;
  } catch (error) {
    report(error);
  } finally {
    busy.value = false;
  }
}

function newDocument() {
  current.value = null;
  title.value = "";
  content.value = "";
  versions.value = [];
  creating.value = true;
  conflict.value = false;
  errorMessage.value = "";
  message.value = "";
}

async function refreshRevision() {
  if (!current.value || busy.value) return;
  busy.value = true;
  errorMessage.value = "";
  try {
    const response = await $fetch<{ document: Document }>(
      `${base.value}/${current.value.id}`,
    );
    current.value = response.document;
    conflict.value = false;
    message.value =
      "최신 revision을 불러왔습니다. 입력한 내용은 그대로 유지됩니다. 내용을 확인한 뒤 저장하세요.";
  } catch (error) {
    report(error);
  } finally {
    busy.value = false;
  }
}

async function save() {
  if (busy.value || !selected.value || (!creating.value && !current.value))
    return;
  busy.value = true;
  errorMessage.value = "";
  message.value = "";
  try {
    const token = (await $fetch<{ csrfToken: string }>("/api/v1/csrf-token"))
      .csrfToken;
    const response = creating.value
      ? await $fetch<{ document: Document }>(base.value, {
          method: "POST",
          headers: { "X-CSRF-Token": token },
          body: { title: title.value, contentMd: content.value },
        })
      : await $fetch<{ document: Document }>(
          `${base.value}/${current.value!.id}`,
          {
            method: "PATCH",
            headers: { "X-CSRF-Token": token },
            body: {
              title: title.value,
              contentMd: content.value,
              expectedRevision: current.value!.revision,
            },
          },
        );
    current.value = response.document;
    title.value = response.document.title;
    content.value = response.document.contentMd;
    creating.value = false;
    conflict.value = false;
    message.value = "저장했습니다.";
    const [list, history] = await Promise.all([
      $fetch<{ documents: Document[] }>(base.value),
      $fetch<{ versions: Version[] }>(
        `${base.value}/${response.document.id}/versions`,
      ),
    ]);
    documents.value = list.documents;
    versions.value = history.versions;
  } catch (error) {
    if (statusOf(error) === 409) {
      conflict.value = true;
      errorMessage.value =
        "다른 변경과 충돌했습니다. 입력한 내용은 보존됩니다.";
    } else {
      report(error);
    }
  } finally {
    busy.value = false;
  }
}
</script>

<!-- eslint-disable vue/html-self-closing -- Prettier formats void tags as self-closing. -->
<template>
  <main>
    <h1>조직과 문서</h1>
    <NuxtLink to="/login">계정으로 돌아가기</NuxtLink>
    <p v-if="loading">조직을 불러오고 있습니다…</p>
    <template v-else>
      <p v-if="errorMessage" role="alert">{{ errorMessage }}</p>
      <p v-if="message" role="status">{{ message }}</p>
      <button
        v-if="!organizations.length && errorMessage"
        type="button"
        @click="loadOrganizations"
      >
        다시 시도
      </button>
      <p v-else-if="!organizations.length">
        소속된 조직이 없습니다. 데모 계정을 이용해 주세요.
      </p>
      <section v-if="organizations.length">
        <h2>조직 선택</h2>
        <button
          v-for="organization in organizations"
          :key="organization.slug"
          type="button"
          :disabled="busy"
          @click="selectOrganization(organization)"
        >
          {{ organization.name }} ({{ organization.role }})
        </button>
      </section>
      <section v-if="selected">
        <h2>{{ selected.name }} 문서</h2>
        <p v-if="busy">처리 중…</p>
        <p v-else-if="!documents.length">문서가 없습니다.</p>
        <ul v-if="documents.length">
          <li v-for="document in documents" :key="document.id">
            <button
              type="button"
              :disabled="busy"
              @click="openDocument(document.id)"
            >
              {{ document.title }}
            </button>
          </li>
        </ul>
        <button
          v-if="canWrite"
          type="button"
          :disabled="busy"
          @click="newDocument"
        >
          새 문서
        </button>
      </section>
      <section v-if="creating || current">
        <h2>{{ creating ? "문서 만들기" : "문서 상세" }}</h2>
        <form @submit.prevent="save">
          <label for="document-title">제목</label>
          <input
            id="document-title"
            v-model="title"
            required
            :disabled="busy || !canWrite"
          />
          <label for="document-content">본문 (Markdown 원문)</label>
          <textarea
            id="document-content"
            v-model="content"
            rows="12"
            :disabled="busy || !canWrite"
          />
          <p v-if="current">
            버전 {{ current.contentVersion }} · revision {{ current.revision }}
          </p>
          <button v-if="canWrite" type="submit" :disabled="busy || conflict">
            저장
          </button>
          <button
            v-if="conflict"
            type="button"
            :disabled="busy"
            @click="refreshRevision"
          >
            최신 revision 불러오기
          </button>
        </form>
        <section v-if="current">
          <details>
            <summary>현재 서버에 저장된 내용</summary>
            <p>{{ current.title }}</p>
            <pre>{{ current.contentMd }}</pre>
          </details>
          <h3>변경 이력</h3>
          <ol>
            <li v-for="version in versions" :key="version.version">
              <details>
                <summary>
                  버전 {{ version.version }} · {{ version.changeType }} ·
                  {{ version.createdAt }}
                </summary>
                <p>{{ version.title }}</p>
                <pre>{{ version.contentMd }}</pre>
              </details>
            </li>
          </ol>
        </section>
      </section>
    </template>
  </main>
</template>
