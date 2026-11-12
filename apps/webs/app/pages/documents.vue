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
interface Category {
  id: string;
  name: string;
  deleted: boolean;
}

const organizations = ref<Organization[]>([]);
const selected = ref<Organization | null>(null);
const documents = ref<Document[]>([]);
const current = ref<Document | null>(null);
const versions = ref<Version[]>([]);
const categories = ref<Category[]>([]);
const trashed = ref<Document[]>([]);
const categoryId = ref("");
const categoryName = ref("");
const managedCategory = ref("");
const recoveryCategory = ref("keep");
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
const canManage = computed(
  () => selected.value?.role === "owner" || selected.value?.role === "admin",
);
const orgBase = computed(
  () => `/api/v1/orgs/${encodeURIComponent(selected.value?.slug ?? "")}`,
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
    const [list, categoryList] = await Promise.all([
      $fetch<{ documents: Document[] }>(base.value),
      $fetch<{ categories: Category[] }>(`${orgBase.value}/categories`),
    ]);
    documents.value = list.documents;
    categories.value = categoryList.categories;
    trashed.value = [];
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
    categoryId.value = detail.document.categoryId ?? "";
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
  categoryId.value = "";
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
          body: {
            title: title.value,
            contentMd: content.value,
            categoryId: categoryId.value || null,
          },
        })
      : await $fetch<{ document: Document }>(
          `${base.value}/${current.value!.id}`,
          {
            method: "PATCH",
            headers: { "X-CSRF-Token": token },
            body: {
              title: title.value,
              contentMd: content.value,
              categoryId: categoryId.value || null,
              expectedRevision: current.value!.revision,
            },
          },
        );
    current.value = response.document;
    title.value = response.document.title;
    content.value = response.document.contentMd;
    categoryId.value = response.document.categoryId ?? "";
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

async function mutate<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: Record<string, string | null>,
): Promise<T> {
  const token = (await $fetch<{ csrfToken: string }>("/api/v1/csrf-token"))
    .csrfToken;
  return $fetch<T>(path, { method, headers: { "X-CSRF-Token": token }, body });
}

async function manageCategory(
  action: "create" | "rename" | "delete" | "restore",
) {
  if (busy.value) return;
  busy.value = true;
  errorMessage.value = "";
  message.value = "";
  try {
    const path = `${orgBase.value}/categories`;
    if (action === "create")
      await mutate(path, "POST", { name: categoryName.value });
    else {
      if (!managedCategory.value) throw new Error("Select a category");
      const target = `${path}/${managedCategory.value}`;
      if (action === "rename")
        await mutate(target, "PATCH", { name: categoryName.value });
      if (action === "delete") await mutate(target, "DELETE");
      if (action === "restore") await mutate(`${target}/restore`, "POST");
    }
    categories.value = (
      await $fetch<{ categories: Category[] }>(path)
    ).categories;
    message.value = "카테고리를 변경했습니다.";
  } catch (error) {
    errorMessage.value =
      statusOf(error) === 409
        ? "이미 사용 중인 이름이거나 활성 문서가 연결된 카테고리입니다."
        : "카테고리를 변경하지 못했습니다. 선택과 입력값을 확인해 주세요.";
  } finally {
    busy.value = false;
  }
}

async function loadTrash() {
  if (busy.value) return;
  busy.value = true;
  errorMessage.value = "";
  try {
    trashed.value = (
      await $fetch<{ documents: Document[] }>(`${orgBase.value}/trash`)
    ).documents;
  } catch (error) {
    report(error);
  } finally {
    busy.value = false;
  }
}

function restoreBody(expectedRevision: string): Record<string, string | null> {
  return recoveryCategory.value === "keep"
    ? { expectedRevision }
    : {
        expectedRevision,
        categoryId:
          recoveryCategory.value === "none" ? null : recoveryCategory.value,
      };
}

async function deleteDocument() {
  if (busy.value || !current.value) return;
  busy.value = true;
  errorMessage.value = "";
  try {
    await mutate(`${base.value}/${current.value.id}`, "DELETE", {
      expectedRevision: current.value.revision,
    });
    current.value = null;
    documents.value = (
      await $fetch<{ documents: Document[] }>(base.value)
    ).documents;
    trashed.value = (
      await $fetch<{ documents: Document[] }>(`${orgBase.value}/trash`)
    ).documents;
    message.value = "휴지통으로 이동했습니다.";
  } catch (error) {
    if (statusOf(error) === 409) {
      conflict.value = true;
      errorMessage.value =
        "다른 변경과 충돌했습니다. 입력한 내용은 보존됩니다.";
    } else report(error);
  } finally {
    busy.value = false;
  }
}

async function restoreDocument(document: Document) {
  if (busy.value) return;
  busy.value = true;
  errorMessage.value = "";
  try {
    await mutate(
      `${orgBase.value}/trash/${document.id}/restore`,
      "POST",
      restoreBody(document.revision),
    );
    documents.value = (
      await $fetch<{ documents: Document[] }>(base.value)
    ).documents;
    trashed.value = (
      await $fetch<{ documents: Document[] }>(`${orgBase.value}/trash`)
    ).documents;
    message.value = "문서를 복구했습니다.";
  } catch (error) {
    if (statusOf(error) === 409)
      errorMessage.value =
        "문서가 변경되었습니다. 휴지통을 다시 불러와 주세요.";
    else if (statusOf(error) === 404)
      errorMessage.value =
        "문서 또는 카테고리를 찾을 수 없습니다. 활성 카테고리나 없음을 선택해 주세요.";
    else report(error);
  } finally {
    busy.value = false;
  }
}

async function restoreVersion(version: string) {
  if (busy.value || !current.value) return;
  busy.value = true;
  errorMessage.value = "";
  try {
    const result = await mutate<{ document: Document }>(
      `${base.value}/${current.value.id}/versions/${version}/restore`,
      "POST",
      restoreBody(current.value.revision),
    );
    current.value = result.document;
    title.value = result.document.title;
    content.value = result.document.contentMd;
    categoryId.value = result.document.categoryId ?? "";
    versions.value = (
      await $fetch<{ versions: Version[] }>(
        `${base.value}/${result.document.id}/versions`,
      )
    ).versions;
    documents.value = (
      await $fetch<{ documents: Document[] }>(base.value)
    ).documents;
    message.value = "과거 버전을 복원했습니다.";
  } catch (error) {
    if (statusOf(error) === 409) {
      conflict.value = true;
      errorMessage.value =
        "다른 변경과 충돌했습니다. 입력한 내용은 보존됩니다.";
    } else if (statusOf(error) === 404) {
      errorMessage.value =
        "문서, 버전 또는 카테고리를 찾을 수 없습니다. 활성 카테고리나 없음을 선택해 주세요.";
    } else report(error);
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
      <section v-if="selected && canManage">
        <h2>카테고리 관리</h2>
        <label for="category-name">카테고리 이름</label>
        <input id="category-name" v-model="categoryName" :disabled="busy" />
        <button
          type="button"
          :disabled="busy"
          @click="manageCategory('create')"
        >
          카테고리 추가
        </button>
        <label for="managed-category">관리할 카테고리</label>
        <select
          id="managed-category"
          v-model="managedCategory"
          :disabled="busy"
        >
          <option value="">선택</option>
          <option
            v-for="category in categories"
            :key="category.id"
            :value="category.id"
          >
            {{ category.name }}{{ category.deleted ? " (삭제됨)" : "" }}
          </option>
        </select>
        <button
          type="button"
          :disabled="busy || !managedCategory"
          @click="manageCategory('rename')"
        >
          이름 변경
        </button>
        <button
          type="button"
          :disabled="busy || !managedCategory"
          @click="manageCategory('delete')"
        >
          카테고리 삭제
        </button>
        <button
          type="button"
          :disabled="busy || !managedCategory"
          @click="manageCategory('restore')"
        >
          카테고리 복구
        </button>
        <h2>휴지통</h2>
        <button type="button" :disabled="busy" @click="loadTrash">
          휴지통 불러오기
        </button>
        <ul>
          <li v-for="document in trashed" :key="document.id">
            {{ document.title }}
            <button
              type="button"
              :disabled="busy"
              @click="restoreDocument(document)"
            >
              문서 복구
            </button>
          </li>
        </ul>
      </section>
      <section v-if="selected && canWrite">
        <label for="recovery-category">복원 시 카테고리</label>
        <select
          id="recovery-category"
          v-model="recoveryCategory"
          :disabled="busy"
        >
          <option value="keep">기존 카테고리 유지</option>
          <option value="none">카테고리 없음</option>
          <option
            v-for="category in categories.filter((item) => !item.deleted)"
            :key="category.id"
            :value="category.id"
          >
            {{ category.name }}
          </option>
        </select>
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
          <label for="document-category">카테고리</label>
          <select
            id="document-category"
            v-model="categoryId"
            :disabled="busy || !canWrite"
          >
            <option value="">없음</option>
            <option
              v-for="category in categories.filter((item) => !item.deleted)"
              :key="category.id"
              :value="category.id"
            >
              {{ category.name }}
            </option>
          </select>
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
          <button
            v-if="canManage"
            type="button"
            :disabled="busy"
            @click="deleteDocument"
          >
            문서 삭제
          </button>
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
                <button
                  v-if="canWrite"
                  type="button"
                  :disabled="busy"
                  @click="restoreVersion(version.version)"
                >
                  이 버전 복원
                </button>
              </details>
            </li>
          </ol>
        </section>
      </section>
    </template>
  </main>
</template>
