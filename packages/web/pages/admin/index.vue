<!--
  packages/web/pages/admin/index.vue

  The middleware (packages/web/middleware/admin.ts) handles:
    - Unauthenticated → /login?redirect=/admin
    - Wrong role       → /
-->
<template>
  <div class="min-h-screen overflow-x-hidden bg-gray-50 dark:bg-gray-950">
    <AppHeader />

    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <header class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 class="text-3xl font-bold text-gray-900 dark:text-white">Admin Console</h1>
          <p class="text-gray-600 dark:text-gray-400">Homepage curation + uploader controls in one place.</p>
        </div>
        <div class="flex items-center gap-2">
          <span
            v-if="activeAdminTab === 'homepage'"
            class="px-2 py-1 rounded-full text-xs font-semibold"
            :class="homepageDirty ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'"
          >
            {{ homepageDirty ? 'Unsaved homepage changes' : 'Homepage synced' }}
          </span>
          <button
            class="px-4 py-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-sm text-gray-900 dark:text-gray-100"
            @click="reloadAll"
          >
            Reload
          </button>
          <button
            class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
            :disabled="saving"
            @click="saveAll"
          >
            {{ saving ? 'Saving...' : 'Save changes' }}
          </button>
        </div>
      </header>

      <div v-if="saveMessage" class="rounded-lg border px-4 py-3 text-sm" :class="saveMessageClass">
        {{ saveMessage }}
      </div>

      <div role="tablist" aria-label="Admin sections" class="flex gap-2 border-b border-gray-200 dark:border-gray-800 overflow-x-auto whitespace-nowrap pb-1">
        <button
          v-for="tab in adminTabs"
          :key="tab.id"
          role="tab"
          :aria-selected="activeAdminTab === tab.id"
          :aria-controls="`${tab.id}-panel`"
          :tabindex="activeAdminTab === tab.id ? 0 : -1"
          class="px-4 py-2 text-sm font-medium -mb-px border-b-2"
          :class="activeAdminTab===tab.id ? 'border-blue-600 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-600 dark:text-gray-400'"
          @click="setAdminTab(tab.id)"
        >{{ tab.label }}</button>
      </div>

      <section class="space-y-8">
        <div
          v-if="activeAdminTab === 'homepage' && homepagePreviewModel.hasFeaturedRowBlock"
          id="homepage-panel"
          role="tabpanel"
          class="p-6 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800"
        >
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-bold text-gray-900 dark:text-white">Featured videos</h2>
            <p class="text-sm text-gray-600 dark:text-gray-400">Click a slot to replace</p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              v-for="(video, slotIndex) in featuredVideos"
              :key="`featured-${slotIndex}-${video?.id ?? 'empty'}`"
              class="text-left group"
              @click="openPicker(slotIndex)"
            >
              <div class="relative aspect-video rounded-lg overflow-hidden bg-gray-200 dark:bg-gray-800 mb-2 ring-2 ring-transparent group-hover:ring-blue-500 transition-all">
                <img v-if="video?.thumbnail_url" :src="video.thumbnail_url" :alt="video.title" class="w-full h-full object-cover" />
                <div v-else class="w-full h-full flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">Select featured video</div>
              </div>
              <h3 class="font-semibold text-gray-900 dark:text-white line-clamp-2 mb-1">{{ video?.title || `Slot ${slotIndex + 1}` }}</h3>
              <p class="text-xs text-gray-600 dark:text-gray-400">{{ video?.id || 'No video selected' }}</p>
            </button>
          </div>
        </div>

        <div v-if="activeAdminTab === 'homepage'" class="p-6 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-bold text-gray-900 dark:text-white">Homepage blocks</h2>
            <button class="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg" @click="addBlock('top_video')">
              <span class="text-lg leading-none">+</span>
              Add block
            </button>
          </div>

          <div class="space-y-3">
            <div
              v-for="(block, index) in layoutBlocks"
              :key="block.id"
              class="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950"
              draggable="true"
              @dragstart="onDragStart(index)"
              @dragover.prevent
              @drop="onDrop(index)"
            >
              <div class="flex items-center gap-3 mb-3">
                <span class="cursor-move text-gray-500">↕</span>
                <select
                  v-model="block.type"
                  aria-label="Homepage block type"
                  class="px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:[color-scheme:dark] text-sm text-gray-900 dark:text-white"
                >
                  <option v-for="componentType in blockTypeOptions(block.type)" :key="componentType" :value="componentType">{{ componentType }}</option>
                </select>
                <button class="ml-auto text-sm text-red-600 hover:underline" @click="removeBlock(block.id)">Remove</button>
              </div>
              <div class="grid gap-3">
                <input v-model="block.title" type="text" placeholder="Block title" class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400" />
                <textarea v-model="block.body" rows="3" placeholder="Block copy" class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400"></textarea>
                <select
                  v-if="block.type === 'category'"
                  v-model="block.categoryId"
                  class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white"
                >
                  <option value="">Select category</option>
                  <option v-for="cat in categories" :key="`block-cat-${block.id}-${cat.id}`" :value="cat.id">{{ cat.name }}</option>
                </select>
                <label v-if="block.type === 'category'" class="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input v-model="block.rightRailWithNextSideMini" type="checkbox" class="rounded border-gray-300 dark:border-gray-600">
                  Pair next side-mini category on right (2x2 + 2x1)
                </label>
                <div
                  v-if="(block.type === 'split_horizontal' || block.type === 'split_vertical') && block.childBlocks"
                  class="grid gap-3 rounded-md border border-dashed border-gray-300 dark:border-gray-700 p-3"
                >
                  <div
                    v-for="(child, childIndex) in block.childBlocks"
                    :key="`${block.id}-child-${childIndex}`"
                    class="grid gap-2 rounded border border-gray-200 dark:border-gray-700 p-2 bg-white dark:bg-gray-900"
                  >
                    <div class="text-xs font-semibold text-gray-600 dark:text-gray-400">Child block {{ childIndex + 1 }}</div>
                    <select
                      v-model="child.type"
                      aria-label="Homepage child block type"
                      class="px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:[color-scheme:dark] text-sm text-gray-900 dark:text-white"
                    >
                      <option v-for="componentType in leafBlockTypeOptions(child.type)" :key="`${block.id}-child-type-${componentType}`" :value="componentType">{{ componentType }}</option>
                    </select>
                    <input v-model="child.title" type="text" placeholder="Child block title" class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400" />
                    <textarea v-model="child.body" rows="2" placeholder="Child block copy" class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400"></textarea>
                    <select
                      v-if="child.type === 'category'"
                      v-model="child.categoryId"
                      class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white"
                    >
                      <option value="">Select category</option>
                      <option v-for="cat in categories" :key="`block-child-cat-${block.id}-${childIndex}-${cat.id}`" :value="cat.id">{{ cat.name }}</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="activeAdminTab === 'homepage'" class="p-6 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 space-y-6">
          <div class="flex items-center justify-between">
            <h2 class="text-xl font-bold text-gray-900 dark:text-white">Live homepage preview</h2>
            <p class="text-xs text-gray-500 dark:text-gray-400">Matches public rendering. Save applies changes.</p>
          </div>
          <div class="rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-8 bg-gray-50/50 dark:bg-gray-950/50">
            <section
              v-for="block in homepagePreviewModel.blockItems"
              :key="`preview-block-${block?.id}`"
              class="space-y-3"
            >
              <div>
                <h3 class="text-xl font-semibold text-gray-900 dark:text-white">{{ block.title || block.type }}</h3>
                <p v-if="block.body" class="text-sm text-gray-600 dark:text-gray-400">{{ block.body }}</p>
              </div>

              <div v-if="block.type === 'featured_row'" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <VideoCard
                  v-for="video in block.videos"
                  :key="`preview-featured-${video.id}`"
                  :video="video"
                  :show-description="false"
                  :show-relative-timestamp="true"
                />
              </div>

              <div v-else-if="block.type === 'top_video'" class="space-y-4">
                <VideoCard
                  v-for="video in block.videos"
                  :key="`preview-top-video-${video.id}`"
                  :video="video"
                  layout="horizontal"
                  :show-description="false"
                  :show-relative-timestamp="true"
                />
              </div>

              <div v-else-if="block.type === 'category'" class="space-y-3">
                <div v-if="block.categorySection" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <VideoCard
                    v-for="video in block.categorySection.visible"
                    :key="`preview-category-video-${block.categorySection.category.id}-${video.id}`"
                    :video="video"
                    :show-description="false"
                    :show-relative-timestamp="true"
                  />
                </div>
                <p v-else class="text-xs text-gray-500 dark:text-gray-400">No category selected or no videos available.</p>
              </div>
              <div v-else-if="block.type === 'category_with_side_mini'" class="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <div class="xl:col-span-2 space-y-3">
                  <div v-if="block.primary.categorySection" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <VideoCard
                      v-for="video in block.primary.categorySection.visible"
                      :key="`preview-paired-main-${block.primary.id}-${video.id}`"
                      :video="video"
                      :show-description="false"
                      :show-relative-timestamp="true"
                    />
                  </div>
                </div>
                <div class="space-y-3">
                  <h4 class="font-semibold text-gray-900 dark:text-white">{{ block.sideMini.title || block.sideMini.categorySection?.category?.name || 'Side mini' }}</h4>
                  <div v-if="block.sideMini.categorySection" class="space-y-3">
                    <VideoCard
                      v-for="video in block.sideMini.categorySection.visible"
                      :key="`preview-paired-side-${block.sideMini.id}-${video.id}`"
                      :video="video"
                      layout="horizontal"
                      :show-description="false"
                      :show-relative-timestamp="true"
                    />
                  </div>
                </div>
              </div>

              <div v-else-if="block.type === 'split_horizontal' || block.type === 'split_vertical'" class="grid gap-4" :class="block.type === 'split_horizontal' ? 'md:grid-cols-2' : 'grid-cols-1'">
                <section
                  v-for="child in block.children"
                  :key="`preview-split-child-${child.id}`"
                  class="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3"
                >
                  <h4 class="font-semibold text-gray-900 dark:text-white">{{ child.title || child.type }}</h4>
                  <p v-if="child.body" class="text-sm text-gray-600 dark:text-gray-400">{{ child.body }}</p>
                  <div v-if="child.type === 'featured_row'" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <VideoCard
                      v-for="video in child.videos"
                      :key="`preview-split-featured-${child.id}-${video.id}`"
                      :video="video"
                      :show-description="false"
                      :show-relative-timestamp="true"
                    />
                  </div>
                  <div v-else-if="child.type === 'top_video'" class="space-y-3">
                    <VideoCard
                      v-for="video in child.videos"
                      :key="`preview-split-top-${child.id}-${video.id}`"
                      :video="video"
                      layout="horizontal"
                      :show-description="false"
                      :show-relative-timestamp="true"
                    />
                  </div>
                  <div v-else-if="child.categorySection" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <VideoCard
                      v-for="video in child.categorySection.visible"
                      :key="`preview-split-category-video-${child.id}-${video.id}`"
                      :video="video"
                      :show-description="false"
                      :show-relative-timestamp="true"
                    />
                  </div>
                </section>
              </div>
              <p v-else class="text-xs text-gray-500 dark:text-gray-400">No videos assigned to this block.</p>
            </section>
          </div>
        </div>

        <!-- Video Management -->
        <div v-if="activeAdminTab === 'videos'" id="videos-panel" role="tabpanel" class="p-6 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
          <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 class="text-xl font-bold text-gray-900 dark:text-white">Video management</h2>
            <button
              class="inline-flex items-center gap-2 px-3 py-2 rounded bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold"
              @click="openLivestreamModal"
            >
              <span class="text-base leading-none">+</span>
              Create new livestream
            </button>
          </div>
          <div v-if="systemFeatures.videoUploaderEnabled" class="mb-4 rounded-lg border border-gray-200 dark:border-gray-800 p-3 bg-gray-50 dark:bg-gray-950/40">
            <div class="flex flex-wrap items-center gap-2 mb-2">
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Direct source upload (MediaConvert)</h3>
              <span v-if="!mediaConvertConfig.enabled" class="text-[11px] px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-300">disabled</span>
              <span v-else-if="!mediaConvertConfig.configured" class="text-[11px] px-2 py-0.5 rounded bg-amber-200 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">not configured</span>
              <span v-else class="text-[11px] px-2 py-0.5 rounded bg-emerald-200 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">enabled</span>
            </div>
            <p class="text-xs text-gray-600 dark:text-gray-400 mb-3">
              Optional cloud path. Existing local/rclone workflow remains unchanged.
            </p>
            <div class="grid grid-cols-1 md:grid-cols-4 gap-2">
              <input v-model="mediaUpload.title" type="text" placeholder="Video title" class="px-2 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
              <input v-model="mediaUpload.description" type="text" placeholder="Description (optional)" class="px-2 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm md:col-span-2" />
              <input type="file" accept="video/*" :disabled="mediaUpload.busy" class="px-2 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 file:text-gray-900 dark:file:text-gray-100 file:bg-transparent text-sm disabled:opacity-60 disabled:cursor-not-allowed" @change="onMediaUploadFileChange" />
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <button
                class="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-50"
                :disabled="mediaUpload.busy || !mediaUpload.file || !mediaConvertConfig.enabled || !mediaConvertConfig.configured || !mediaConvertConfig.tusConfigured"
                @click="startMediaConvertUpload"
              >
                {{ mediaUpload.busy ? 'Uploading…' : 'Upload & transcode' }}
              </button>
              <span class="text-xs text-gray-600 dark:text-gray-300">
                status: <strong>{{ mediaUpload.status }}</strong>
              </span>
              <span class="text-xs text-gray-500 dark:text-gray-400">
                {{ mediaUpload.progress }}%
              </span>
            </div>
            <div class="mt-2 h-1.5 w-full rounded bg-gray-200 dark:bg-gray-800 overflow-hidden">
              <div class="h-full bg-blue-600 transition-all" :style="{ width: `${mediaUpload.progress}%` }"></div>
            </div>
            <p v-if="mediaUpload.message" class="mt-2 text-xs" :class="mediaUpload.error ? 'text-red-600 dark:text-red-300' : 'text-gray-600 dark:text-gray-300'">
              {{ mediaUpload.message }}
            </p>
          </div>
          <div v-else class="mb-4 rounded-lg border border-amber-200 dark:border-amber-900 p-3 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-200">
            Video uploader is disabled by system feature toggle.
          </div>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">Set preview lock per video: 0s means premium-only access, while matching full duration unlocks the full video.</p>
          <div>
            <div v-if="videosLoading" class="space-y-3">
              <div v-for="n in 4" :key="n" class="h-14 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
            </div>
            <div v-else-if="!chronologicallySortedUploads.length" class="text-sm text-gray-500 dark:text-gray-400 py-4">
              No videos found. Upload via rclone — they'll appear here as drafts.
            </div>
            <div v-else class="w-full overflow-x-auto">
              <table class="min-w-[920px] w-full text-sm">
                <thead>
                  <tr class="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th class="sticky top-0 z-10 bg-white dark:bg-gray-900 pb-2 pr-4 font-medium w-16">Thumb</th>
                    <th class="sticky top-0 z-10 bg-white dark:bg-gray-900 pb-2 pr-4 font-medium">Title</th>
                    <th class="sticky top-0 z-10 bg-white dark:bg-gray-900 pb-2 pr-4 font-medium">Status</th>
                    <th class="sticky top-0 z-10 bg-white dark:bg-gray-900 pb-2 pr-4 font-medium w-[1%] whitespace-nowrap">Category</th>
                    <th class="sticky top-0 z-10 bg-white dark:bg-gray-900 pb-2 pr-4 font-medium">Duration</th>
                    <th class="sticky top-0 z-10 bg-white dark:bg-gray-900 pb-2 pr-4 font-medium">Preview lock</th>
                    <th class="sticky top-0 z-10 bg-white dark:bg-gray-900 pb-2 pr-4 font-medium">Views</th>
                    <th class="sticky top-0 z-10 bg-white dark:bg-gray-900 pb-2 pr-4 font-medium">Uploaded</th>
                    <th class="sticky top-0 z-10 bg-white dark:bg-gray-900 pb-2 pr-4 font-medium">Notifications</th>
                    <th class="sticky top-0 z-10 bg-white dark:bg-gray-900 pb-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
                  <tr v-for="video in chronologicallySortedUploads" :key="video.id">
                    <td class="py-3 pr-4">
                      <label
                        :for="`thumb-input-${video.id}`"
                        class="relative block w-14 aspect-video rounded overflow-hidden bg-gray-200 dark:bg-gray-800
                               cursor-pointer ring-2 ring-transparent hover:ring-blue-500 transition-all group"
                        :title="video.thumbnail_url ? 'Replace thumbnail' : 'Upload thumbnail'"
                      >
                        <!-- Existing thumbnail -->
                        <img
                          v-if="video.thumbnail_url"
                          :src="sizeUrl(video.thumbnail_url, 'small')"
                          :alt="video.title"
                          class="w-full h-full object-cover"
                        />
                        <!-- Placeholder with upload icon -->
                        <div
                          v-else
                          class="w-full h-full flex items-center justify-center text-gray-400 group-hover:text-blue-500 transition-colors"
                        >
                          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round"
                              d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775
                                 5.25 5.25 0 0 1 10.338-2.32 3.75 3.75 0 0 1 3.571 5.095" />
                          </svg>
                        </div>
                        <!-- Hover replace overlay (only when thumbnail exists) -->
                        <div
                          v-if="video.thumbnail_url"
                          class="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all
                                 flex items-center justify-center opacity-0 group-hover:opacity-100"
                        >
                          <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round"
                              d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775
                                 5.25 5.25 0 0 1 10.338-2.32 3.75 3.75 0 0 1 3.571 5.095" />
                          </svg>
                        </div>
                        <!-- Uploading spinner overlay -->
                        <div
                          v-if="uploadingFor === video.id"
                          class="absolute inset-0 bg-black/60 flex items-center justify-center"
                        >
                          <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        </div>
                        <!-- R2 missing warning -->
                        <span v-if="video.r2_exists === false" class="absolute inset-0 flex items-center justify-center bg-red-900/60 text-white text-xs">⚠</span>
                      </label>
                      <input
                        :id="`thumb-input-${video.id}`"
                        type="file"
                        accept="image/jpeg,image/png"
                        class="sr-only"
                        @change="(e) => handleThumbnailSelect(e, video)"
                      />
                    </td>
                    <td class="py-3 pr-4 max-w-[12rem]">
                      <div v-if="editingTitle?.id === video.id" class="flex items-center gap-1">
                        <input
                          ref="titleInputEl"
                          v-model="editingTitle.value"
                          type="text"
                          class="flex-1 min-w-0 px-2 py-1 text-sm rounded border border-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                          @keydown.enter="saveTitleEdit(video)"
                          @keydown.escape="editingTitle = null"
                          @blur="saveTitleEdit(video)"
                        />
                      </div>
                      <div v-else class="group/title flex min-w-0 items-center gap-1">
                        <p class="min-w-0 font-medium text-gray-900 dark:text-white line-clamp-2 break-words">{{ video.title }}</p>
                        <button
                          class="opacity-0 group-hover/title:opacity-100 p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-opacity"
                          title="Rename"
                          @click="startTitleEdit(video)"
                        >
                          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                      </div>
                      <p class="text-xs text-gray-400 dark:text-gray-500 truncate">{{ video.id }}</p>
                      <!-- Vanity slug editor -->
                      <div class="mt-0.5 group/slug flex items-center gap-1 min-w-0">
                        <div v-if="editingSlug?.id === video.id" class="flex items-center gap-1 w-full">
                          <input
                            ref="slugInputEl"
                            v-model="editingSlug.value"
                            type="text"
                            placeholder="e.g. my-video"
                            class="w-full px-1 py-0.5 text-xs rounded border border-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono"
                            @keydown.enter="saveSlugEdit(video)"
                            @keydown.escape="editingSlug = null"
                            @blur="saveSlugEdit(video)"
                          />
                        </div>
                        <template v-else>
                          <span class="text-xs truncate font-mono" :class="video.slug ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-600'">{{ video.slug || '—' }}</span>
                          <button
                            class="opacity-0 group-hover/slug:opacity-100 p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-opacity flex-shrink-0"
                            title="Edit slug"
                            @click="startSlugEdit(video)"
                          >
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          <a
                            v-if="video.slug"
                            :href="`/watch/${video.slug}`"
                            target="_blank"
                            class="opacity-0 group-hover/slug:opacity-100 p-0.5 text-gray-400 hover:text-blue-500 transition-opacity flex-shrink-0"
                            title="Open watch page"
                          >
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                            </svg>
                          </a>
                        </template>
                      </div>
                      <!-- Legacy slug redirect editor -->
                      <div class="mt-0.5 group/legacy flex items-center gap-1 min-w-0">
                        <div v-if="editingLegacySlug?.id === video.id" class="flex items-center gap-1 w-full">
                          <input
                            ref="legacySlugInputEl"
                            v-model="editingLegacySlug.value"
                            type="text"
                            placeholder="old-platform-video-slug"
                            class="w-full px-1 py-0.5 text-xs rounded border border-amber-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono"
                            @keydown.enter="saveLegacySlugEdit(video)"
                            @keydown.escape="editingLegacySlug = null"
                            @blur="saveLegacySlugEdit(video)"
                          />
                        </div>
                        <template v-else>
                          <span class="text-[11px] truncate font-mono" :class="video.legacy_slug ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-600'">
                            legacy: {{ video.legacy_slug || '—' }}
                          </span>
                          <button
                            class="opacity-0 group-hover/legacy:opacity-100 p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-opacity flex-shrink-0"
                            title="Edit legacy slug redirect"
                            @click="startLegacySlugEdit(video)"
                          >
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          <a
                            v-if="video.legacy_slug"
                            :href="`/videos/${video.legacy_slug}`"
                            target="_blank"
                            class="opacity-0 group-hover/legacy:opacity-100 p-0.5 text-gray-400 hover:text-amber-500 transition-opacity flex-shrink-0"
                            title="Open legacy URL"
                          >
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                            </svg>
                          </a>
                        </template>
                      </div>
                      <!-- Description summary -->
                      <div class="mt-1 flex items-start gap-2 min-w-0">
                        <p class="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 min-w-0">{{ video.description || '—' }}</p>
                        <button
                          type="button"
                          class="p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-opacity flex-shrink-0"
                          title="Edit description"
                          @click="openDescriptionModal(video)"
                        >
                          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                      </div>
                      <div class="mt-1 flex flex-wrap gap-1">
                        <span v-if="video.livestream_provider" class="inline-flex items-center gap-1 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 px-2 py-0.5 text-[10px] font-semibold">🔴 Live</span>
                        <span v-if="video.r2_exists === false && !video.livestream_provider" class="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 px-2 py-0.5 text-[10px] font-semibold">⚠ R2 missing</span>
                      </div>
                    </td>
                    <td class="py-3 pr-4">
                      <div class="space-y-1">
                        <span
                          class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
                          :class="statusBadgeClass(video.publish_status)"
                        >
                          {{ statusBadgeLabel(video) }}
                        </span>
                        <span v-if="video.livestream_provider" class="block text-[11px] text-purple-600 dark:text-purple-300">
                          stream: {{ video.livestream_status || 'draft' }}
                        </span>
                        <span v-if="video.livestream_moq_endpoint" class="block text-[11px] text-gray-600 dark:text-gray-300 truncate max-w-[18rem]" :title="video.livestream_moq_endpoint">
                          MoQ endpoint: {{ video.livestream_moq_endpoint }}
                        </span>
                        <span v-if="video.livestream_moq_broadcast" class="block text-[11px] text-gray-600 dark:text-gray-300 font-mono">
                          MoQ broadcast: {{ video.livestream_moq_broadcast }}
                        </span>
                        <span v-if="video.ingest_status" class="block text-[11px] text-blue-600 dark:text-blue-300">
                          ingest: {{ video.ingest_status }}
                          <template v-if="video.media_convert_usage?.normalized_minutes_est !== null && video.media_convert_usage?.normalized_minutes_est !== undefined">
                            · {{ Number(video.media_convert_usage.normalized_minutes_est).toFixed(2) }} norm-min
                          </template>
                        </span>
                      </div>
                    </td>
                    <td class="py-3 pr-4">
                      <select
                        class="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs text-gray-900 dark:text-white"
                        :style="{ width: `${categorySelectWidthCh}ch` }"
                        :value="video.category_id || ''"
                        @change="(e) => updateVideoCategory(video, (e.target as HTMLSelectElement).value)"
                      >
                        <option value="">Uncategorized</option>
                        <option v-for="cat in categories" :key="cat.id" :value="cat.id">
                          {{ cat.name }}
                        </option>
                      </select>
                    </td>
                    <td class="py-3 pr-4 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {{ formatSeconds(getActualDuration(video)) }}
                    </td>
                    <td class="py-3 pr-4">
                      <div class="flex items-center gap-2">
                        <input
                          v-model.number="previewLockByVideoId[video.id]"
                          type="number"
                          min="0"
                          :max="getActualDuration(video)"
                          :disabled="Boolean(video.livestream_provider)"
                          class="w-24 px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                        />
                        <button class="text-xs text-gray-600 dark:text-gray-300 hover:underline whitespace-nowrap" @click="previewLockByVideoId[video.id] = getActualDuration(video)">Unlock full</button>
                      </div>
                    </td>
                    <td class="py-3 pr-4 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {{ Number(video.total_views || 0).toLocaleString() }}
                    </td>
                    <td class="py-3 pr-4 text-gray-600 dark:text-gray-400 align-top whitespace-nowrap">
                      {{ formatDateTime(video.upload_date) }}
                    </td>
                    <td class="py-3 pr-4">
                      <button
                        v-if="video.publish_status === 'published' && !isVideoNotified(video)"
                        class="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-50 whitespace-nowrap"
                        :disabled="notifying[video.id]"
                        :title="notifying[video.id] ? 'Sending…' : 'Send push notification to all subscribers'"
                        @click="sendNotification(video)"
                      >
                        <svg class="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zm0 16a2 2 0 002-2H8a2 2 0 002 2z" />
                        </svg>
                        {{ notifying[video.id] ? 'Sending…' : 'Notify' }}
                      </button>
                      <span
                        v-else-if="video.publish_status === 'published' && isVideoNotified(video)"
                        class="text-xs font-semibold text-emerald-600 dark:text-emerald-300"
                      >Notified</span>
                      <span v-else class="text-xs text-gray-400 dark:text-gray-600">—</span>
                    </td>
                    <td class="py-3">
                      <div class="flex flex-wrap gap-2">
                        <button
                          v-if="video.publish_status !== 'published'"
                          class="px-2 py-1 text-xs rounded bg-green-600 hover:bg-green-700 text-white font-medium disabled:opacity-50"
                          :disabled="statusUpdating[video.id]"
                          @click="updateVideoStatus(video, 'published', null)"
                        >Publish</button>
                        <button
                          type="button"
                          class="px-2 py-1 text-xs rounded bg-sky-600 hover:bg-sky-700 text-white font-medium disabled:opacity-50"
                          :disabled="statusUpdating[video.id]"
                          @click="openScheduleModal(video)"
                        >Schedule</button>
                        <button
                          v-if="video.publish_status !== 'draft'"
                          class="px-2 py-1 text-xs rounded bg-amber-500 hover:bg-amber-600 text-white font-medium disabled:opacity-50"
                          :disabled="statusUpdating[video.id]"
                          @click="openConfirmModal(video, 'revert_to_draft')"
                        >Revert to draft</button>
                        <button
                          v-if="video.publish_status === 'published'"
                          class="px-2 py-1 text-xs rounded bg-purple-600 hover:bg-purple-700 text-white font-medium"
                          title="Swap this published video with a draft"
                          @click="openSwapModal(video)"
                        >Swap</button>
                        <button
                          class="px-2 py-1 text-xs rounded bg-red-600 hover:bg-red-700 text-white font-medium disabled:opacity-50"
                          :disabled="trashing[video.id] || statusUpdating[video.id]"
                          :title="`Permanently delete ${video.title} from D1 and R2`"
                          @click="openConfirmModal(video, 'trash')"
                        >{{ trashing[video.id] ? 'Deleting…' : 'Trash' }}</button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

        </div>


        <div v-if="activeAdminTab === 'categories'" id="categories-panel" role="tabpanel" class="p-6 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-xl font-bold text-gray-900 dark:text-white">Category management</h2>
            <button class="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 text-sm" @click="loadCategories">Refresh</button>
          </div>

          <div v-if="!isAdmin" class="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
            Only admins and super_admin can create, update, or delete categories.
          </div>

          <template v-else>
            <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
              <h3 class="font-semibold text-gray-900 dark:text-white">Create category</h3>
              <div class="grid grid-cols-1 md:grid-cols-5 gap-3">
                <input v-model="categoryForm.name" type="text" placeholder="Name" class="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                <input v-model="categoryForm.slug" type="text" placeholder="slug-name" class="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                <input v-model.number="categoryForm.sortOrder" type="number" placeholder="Sort order" class="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                <select v-model="categoryForm.direction" class="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                  <option value="desc">desc</option>
                  <option value="asc">asc</option>
                </select>
                <select v-model="categoryForm.homepageLayoutVariant" class="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                  <option value="three_by_one">3×1 block</option>
                  <option value="side_mini">2×1 small block</option>
                </select>
              </div>
              <button class="px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold" @click="createCategory">Create category</button>
            </div>

            <p class="text-xs text-gray-500 dark:text-gray-400">Ordering rule: categories with <code>sort_order &lt;= 0</code> are P0 and render before all standard categories.</p>

            <div class="space-y-2">
              <div
                v-for="(category, categoryIndex) in categories"
                :key="category.id"
                :data-category-id="category.id"
                tabindex="-1"
                class="rounded-lg border border-gray-200 dark:border-gray-700 p-3 grid grid-cols-1 md:grid-cols-[1fr_1fr_120px_120px_170px_auto_auto] gap-2 items-center"
              >
                <input v-model="category.name" type="text" class="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                <input v-model="category.slug" type="text" class="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                <input v-model.number="category.sort_order" type="number" class="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                <select v-model="category.direction" class="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                  <option value="desc">desc</option>
                  <option value="asc">asc</option>
                </select>
                <select v-model="category.homepage_layout_variant" class="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                  <option value="three_by_one">3×1 block</option>
                  <option value="side_mini">2×1 small block</option>
                </select>
                <div class="flex gap-2">
                  <button class="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 text-xs" :disabled="categoryIndex === 0" aria-label="Move category up" @click="nudgeCategoryOrder(categoryIndex, -1)">↑</button>
                  <button class="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 text-xs" :disabled="categoryIndex === categories.length - 1" aria-label="Move category down" @click="nudgeCategoryOrder(categoryIndex, 1)">↓</button>
                </div>
                <div class="flex gap-2">
                  <button class="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium" @click="updateCategory(category)">Save</button>
                  <button class="px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-xs font-medium" @click="confirmDeleteCategory(category)">Delete</button>
                </div>
              </div>
            </div>
          </template>
        </div>

        <div v-if="activeAdminTab === 'pills'" id="pills-panel" role="tabpanel" class="p-6 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 space-y-5">
          <h2 class="text-xl font-bold text-gray-900 dark:text-white">Pills management</h2>

          <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <h3 class="font-semibold text-gray-900 dark:text-white">External API key</h3>
            <p class="text-sm text-gray-600 dark:text-gray-400">
              Current key: <span class="font-mono">{{ pillsApiKeyMeta.maskedKey || 'not set' }}</span>
              <span v-if="pillsApiKeyMeta.managedByEnv" class="ml-2 text-amber-600 dark:text-amber-400">(managed by environment secret)</span>
            </p>
            <div v-if="!pillsApiKeyMeta.managedByEnv" class="flex flex-wrap gap-2">
              <input v-model="pillsApiKey" type="text" placeholder="Enter new API key" class="min-w-[18rem] px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
              <button class="px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold" @click="savePillsApiKey">Save API key</button>
            </div>
          </div>

          <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <h3 class="font-semibold text-gray-900 dark:text-white">Create pill</h3>
            <div class="grid grid-cols-1 md:grid-cols-4 gap-2">
              <input v-model="newPill.label" type="text" placeholder="Label" class="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
              <input v-model.number="newPill.value" type="number" placeholder="Value" class="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
              <select v-model="newPill.valueMode" class="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                <option value="number">Number</option>
                <option value="percentage">Percentage</option>
                <option value="agree_disagree">Agree/Disagree</option>
                <option value="graph_embed">Graph/Embed</option>
              </select>
              <input v-model="newPill.color" type="text" placeholder="#2563eb" class="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
            </div>
            <div v-if="newPill.valueMode === 'agree_disagree'" class="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input v-model="newPill.valueSecondary" type="number" placeholder="Disagree value" class="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
            </div>
            <div v-if="newPill.valueMode === 'graph_embed'" class="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input v-model="newPill.graphEmbedUrl" type="url" placeholder="Flourish/embed URL" class="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
              <textarea v-model="newPill.graphPayloadJson" rows="2" placeholder='{"series":[...]}' class="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs" />
            </div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input v-model="newPill.imageUrl" type="url" placeholder="Image URL (optional)" class="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
              <input type="file" accept="image/*" class="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 text-sm" @change="uploadPillImage($event, null)" />
              <button class="px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold" @click="createPill">Create</button>
            </div>
          </div>

          <div class="space-y-2">
            <div v-for="(pill, idx) in adminPills" :key="pill.id" class="rounded-lg border border-gray-200 dark:border-gray-700 p-3 grid grid-cols-1 md:grid-cols-2 gap-2 items-start">
              <input v-model="pill.label" type="text" class="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
              <input v-model.number="pill.value" type="number" class="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
              <select v-model="pill.value_mode" class="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                <option value="number">Number</option>
                <option value="percentage">Percentage</option>
                <option value="agree_disagree">Agree/Disagree</option>
                <option value="graph_embed">Graph/Embed</option>
              </select>
              <input v-if="pill.value_mode === 'agree_disagree'" v-model.number="pill.value_secondary" type="number" placeholder="Secondary value" class="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
              <input v-if="pill.value_mode === 'graph_embed'" v-model="pill.graph_embed_url" type="url" placeholder="Embed URL" class="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
              <textarea v-if="pill.value_mode === 'graph_embed'" v-model="pill.graph_payload_json" rows="2" placeholder="Graph payload JSON" class="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs" />
              <input v-model="pill.color" type="text" class="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
              <input v-model="pill.image_url" type="url" placeholder="Image URL (optional)" class="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
              <input type="file" accept="image/*" class="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 text-sm" @change="uploadPillImage($event, pill)" />
              <div class="flex gap-2">
                <button class="px-2 py-1 rounded border text-xs" :disabled="idx===0" @click="movePill(idx, -1)">↑</button>
                <button class="px-2 py-1 rounded border text-xs" :disabled="idx===adminPills.length-1" @click="movePill(idx, 1)">↓</button>
                <button class="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs" @click="savePill(pill)">Save</button>
                <button class="px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-xs" @click="deletePill(pill.id)">Delete</button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="activeAdminTab === 'notifications'" id="notifications-panel" role="tabpanel" class="p-6 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 space-y-3">
          <h2 class="text-xl font-bold text-gray-900 dark:text-white">Notifications</h2>
          <p class="text-sm text-gray-600 dark:text-gray-400">Only published videos that have not been notified yet are listed below.</p>
          <div v-for="video in pendingNotificationVideos" :key="`notify-${video.id}`" class="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
            <p class="text-sm text-gray-800 dark:text-gray-200 truncate pr-4">{{ video.title }}</p>
            <button class="px-2 py-1 text-xs rounded bg-blue-600 hover:bg-blue-700 text-white" :disabled="notifying[video.id]" @click="sendNotification(video)">Notify</button>
          </div>
          <p v-if="!pendingNotificationVideos.length" class="text-xs text-gray-500 dark:text-gray-400">No pending notifications.</p>
          <div v-if="pushCampaignFunnel" class="rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 p-4 space-y-2">
            <h3 class="font-semibold text-gray-900 dark:text-white">Latest push campaign — {{ pushCampaignFunnel.videoTitle }}</h3>
            <p class="text-xs text-gray-600 dark:text-gray-400">Campaign {{ pushCampaignFunnel.campaignId }}</p>
            <p v-if="pushCampaignFunnelError" class="text-xs text-red-700 dark:text-red-300">{{ pushCampaignFunnelError }}</p>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm text-gray-800 dark:text-gray-200">
              <p>Sent: {{ pushCampaignFunnel.sent }}</p>
              <p>Clicks: {{ pushCampaignFunnel.clicks }} ({{ pushCampaignFunnel.clickRatePercent }}%)</p>
              <p>Watch sessions: {{ pushCampaignFunnel.watchSessions }}</p>
              <p>Completion: {{ pushCampaignFunnel.completionRatePercent }}%</p>
            </div>
            <button type="button" class="text-xs text-blue-700 dark:text-blue-300 hover:underline" @click="loadPushCampaignFunnel(pushCampaignFunnel.campaignId, pushCampaignFunnel.videoTitle)">Refresh funnel</button>
          </div>
        </div>

        <div v-if="activeAdminTab === 'newsletter'" id="newsletter-panel" role="tabpanel" class="p-6 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 space-y-6">
          <div>
            <h2 class="text-xl font-bold text-gray-900 dark:text-white">Newsletter</h2>
            <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Sync paying subscribers to a Brevo list (via Stripe webhooks) and send campaigns to that list.
            </p>
          </div>

          <div v-if="!isAdmin" class="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
            Only site administrators can configure Brevo and send newsletter campaigns. Editors can use other admin tabs.
          </div>

          <template v-else>
            <div v-if="newsletterMessage" class="rounded-lg border px-4 py-3 text-sm" :class="newsletterMessageClass">{{ newsletterMessage }}</div>

            <div class="grid gap-4 md:grid-cols-2">
              <div class="space-y-2">
                <label class="block text-sm font-medium text-gray-900 dark:text-white" for="brevo-list-id">Brevo subscriber list ID</label>
                <input
                  id="brevo-list-id"
                  v-model="newsletterListId"
                  type="text"
                  inputmode="numeric"
                  autocomplete="off"
                  placeholder="e.g. 12"
                  class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                />
                <p class="text-xs text-gray-500 dark:text-gray-400">Create a list in Brevo Contacts and paste its numeric ID.</p>
              </div>
              <div class="space-y-2">
                <label class="block text-sm font-medium text-gray-900 dark:text-white" for="brevo-sender-email">Campaign sender email</label>
                <input
                  id="brevo-sender-email"
                  v-model="newsletterSenderEmail"
                  type="email"
                  autocomplete="email"
                  placeholder="verified sender in Brevo"
                  class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                />
                <label class="block text-sm font-medium text-gray-900 dark:text-white mt-3" for="brevo-sender-name">Sender display name (optional)</label>
                <input
                  id="brevo-sender-name"
                  v-model="newsletterSenderName"
                  type="text"
                  autocomplete="off"
                  placeholder="e.g. Your Channel"
                  class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                />
                <label class="block text-sm font-medium text-gray-900 dark:text-white mt-3" for="newsletter-poll-ms">Campaign list refresh interval (ms)</label>
                <input
                  id="newsletter-poll-ms"
                  v-model.number="newsletterPollIntervalMs"
                  type="number"
                  min="60000"
                  max="86400000"
                  step="60000"
                  class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                />
                <p class="text-xs text-gray-500 dark:text-gray-400">How often to refresh the recent campaigns list while this tab is open (60s–24h). Save settings to apply.</p>
              </div>
            </div>

            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
                :disabled="newsletterSaving"
                @click="saveNewsletterSettings"
              >
                {{ newsletterSaving ? 'Saving…' : 'Save newsletter settings' }}
              </button>
              <button
                type="button"
                class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold disabled:opacity-50"
                :disabled="newsletterSyncing"
                @click="syncNewsletterRecipients"
              >
                {{ newsletterSyncing ? 'Syncing…' : 'Sync recipients' }}
              </button>
            </div>

            <div class="border-t border-gray-200 dark:border-gray-700 pt-6 space-y-3">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Saved templates</h3>
              <p class="text-sm text-gray-600 dark:text-gray-400">Create and edit reusable HTML templates stored in the database. Sending still uses Brevo’s campaign API.</p>
              <div class="grid gap-3 md:grid-cols-2">
                <div class="space-y-2">
                  <label class="block text-sm font-medium text-gray-900 dark:text-white" for="tpl-name">Name</label>
                  <input id="tpl-name" v-model="newsletterTemplateForm.name" type="text" class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                  <label class="block text-sm font-medium text-gray-900 dark:text-white" for="tpl-subject">Subject</label>
                  <input id="tpl-subject" v-model="newsletterTemplateForm.subject" type="text" class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                </div>
                <div class="space-y-2">
                  <label class="block text-sm font-medium text-gray-900 dark:text-white" for="tpl-html">HTML body</label>
                  <textarea id="tpl-html" v-model="newsletterTemplateForm.htmlBody" rows="6" class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-sm" />
                  <div class="flex flex-wrap gap-2">
                    <button
                      type="button"
                      class="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-50"
                      :disabled="newsletterTemplateSaving"
                      @click="saveNewsletterTemplate"
                    >
                      {{ newsletterEditingTemplateId ? 'Update template' : 'Create template' }}
                    </button>
                    <button
                      v-if="newsletterEditingTemplateId"
                      type="button"
                      class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm"
                      @click="resetNewsletterTemplateForm"
                    >
                      Cancel edit
                    </button>
                  </div>
                </div>
              </div>
              <ul class="divide-y divide-gray-200 dark:divide-gray-700 rounded-lg border border-gray-200 dark:border-gray-700 max-h-48 overflow-auto">
                <li v-for="tpl in newsletterTemplates" :key="tpl.id" class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span class="font-medium text-gray-900 dark:text-white">{{ tpl.name }}</span>
                  <span class="flex gap-2">
                    <button type="button" class="text-blue-600 dark:text-blue-400 hover:underline" @click="startEditNewsletterTemplate(tpl)">Edit</button>
                    <button type="button" class="text-red-600 dark:text-red-400 hover:underline" @click="deleteNewsletterTemplate(tpl.id, tpl.name)">Delete</button>
                  </span>
                </li>
                <li v-if="!newsletterTemplates.length" class="px-3 py-4 text-gray-500 dark:text-gray-400 text-sm">No templates yet.</li>
              </ul>
            </div>

            <div class="border-t border-gray-200 dark:border-gray-700 pt-6 space-y-3">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Compose campaign</h3>
              <div class="space-y-2">
                <label class="block text-sm font-medium text-gray-900 dark:text-white" for="newsletter-template">Template</label>
                <select id="newsletter-template" v-model="newsletterTemplateId" class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                  <option value="">No template (use manual subject/body)</option>
                  <option v-for="tpl in newsletterTemplates" :key="tpl.id" :value="tpl.id">{{ tpl.name }}</option>
                </select>
                <label class="block text-sm font-medium text-gray-900 dark:text-white" for="newsletter-subject">Subject</label>
                <input
                  id="newsletter-subject"
                  v-model="newsletterSubject"
                  type="text"
                  class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                  placeholder="Email subject line"
                />
              </div>
              <div class="space-y-2">
                <label class="block text-sm font-medium text-gray-900 dark:text-white" for="newsletter-body">HTML body</label>
                <textarea
                  id="newsletter-body"
                  v-model="newsletterHtml"
                  rows="12"
                  class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-sm"
                  placeholder="<p>Hello …</p>"
                />
              </div>
              <div class="grid gap-4 lg:grid-cols-2">
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white mb-2">Preview</p>
                  <iframe
                    v-if="newsletterHtml.trim()"
                    title="Newsletter HTML preview"
                    class="w-full min-h-[12rem] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950"
                    sandbox=""
                    referrerpolicy="no-referrer"
                    :srcdoc="newsletterPreviewSrcdoc"
                  />
                  <div
                    v-else
                    class="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-950 p-4 min-h-[12rem] flex items-center justify-center text-sm text-gray-400"
                  >
                    Preview appears here.
                  </div>
                </div>
                <div class="flex flex-col justify-end gap-2">
                  <button
                    type="button"
                    class="w-full sm:w-auto px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50"
                    :disabled="newsletterSending"
                    @click="sendNewsletterCampaign"
                  >
                    {{ newsletterSending ? 'Sending…' : 'Send to subscriber list' }}
                  </button>
                  <p class="text-xs text-gray-500 dark:text-gray-400">
                    Creates a campaign in Brevo and sends it immediately to the configured list. Ensure your API key has marketing permissions and credits.
                  </p>
                </div>
              </div>
            </div>

            <div class="border-t border-gray-200 dark:border-gray-700 pt-6">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Recent campaigns</h3>
              <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">
                <span v-if="lastCampaignsOkAt">Last refreshed: {{ new Date(lastCampaignsOkAt).toLocaleString() }}</span>
                <span v-if="lastCampaignsError" class="text-red-600 dark:text-red-400"> · Poll error: {{ lastCampaignsError }}</span>
              </p>
              <div class="space-y-2 max-h-56 overflow-auto">
                <div v-for="campaign in newsletterCampaigns" :key="campaign.id" class="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
                  <p class="text-sm font-medium text-gray-900 dark:text-white">{{ campaign.subject || campaign.name }}</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">Status: {{ campaign.status }} · Sent: {{ campaign.sentDate || '—' }}</p>
                </div>
              </div>
            </div>
          </template>
        </div>

        <div v-if="activeAdminTab === 'users'" id="users-panel" role="tabpanel" class="p-6 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 space-y-4">
          <h2 class="text-xl font-bold text-gray-900 dark:text-white">Users and roles</h2>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            Search and filters apply to all accounts. Sensitive changes require confirmation. Subscription edits update the user's latest Stripe-linked row only.
          </p>
          <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <h3 class="font-semibold text-gray-900 dark:text-white">Mass import users from CSV</h3>
            <p class="text-xs text-gray-500 dark:text-gray-400">Imports emails as viewer accounts and marks subscriptions as relink-required for gateway reattachment outreach.</p>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                v-model="usersImportMailingListId"
                type="text"
                placeholder="Dedicated relink mailing list ID"
                class="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
              <button
                class="px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
                :disabled="usersImporting"
                @click="importUsersFromCsv"
              >
                {{ usersImporting ? 'Importing…' : 'Import CSV users' }}
              </button>
            </div>
            <textarea
              v-model="usersImportCsv"
              rows="6"
              class="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs"
              :placeholder="`email\nuser@example.com\nsecond@example.com`"
            />
            <p v-if="usersImportResult" class="text-xs text-emerald-700 dark:text-emerald-300">
              Imported {{ usersImportResult.imported }}, existing {{ usersImportResult.existing }}, total parsed {{ usersImportResult.totalEmails }} · list {{ usersImportResult.mailingListId }}.
            </p>
          </div>
          <div class="flex flex-col lg:flex-row lg:flex-wrap gap-3 items-stretch lg:items-end">
            <div class="flex-1 min-w-[12rem]">
              <label for="users-search" class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Search email or id</label>
              <input
                id="users-search"
                v-model="usersSearchInput"
                type="search"
                autocomplete="off"
                class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
                placeholder="Filter…"
              />
            </div>
            <div>
              <label for="users-role-filter" class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Role</label>
              <select
                id="users-role-filter"
                v-model="usersRoleFilter"
                class="w-full lg:w-40 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
                @change="usersPage = 1; loadUsers()"
              >
                <option value="all">All roles</option>
                <option value="viewer">viewer</option>
                <option value="moderator">moderator</option>
                <option value="analyst">analyst</option>
                <option value="editor">editor</option>
                <option value="admin">admin</option>
                <option value="super_admin">super_admin</option>
              </select>
            </div>
            <div>
              <label for="users-sub-filter" class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Subscription</label>
              <select
                id="users-sub-filter"
                v-model="usersSubscriptionFilter"
                class="w-full lg:w-44 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
                @change="usersPage = 1; loadUsers()"
              >
                <option value="all">Any</option>
                <option value="none">No subscription</option>
                <option value="active">active</option>
                <option value="trialing">trialing</option>
                <option value="past_due">past_due</option>
                <option value="cancelled">cancelled</option>
                <option value="unpaid">unpaid</option>
                <option value="incomplete">incomplete</option>
              </select>
            </div>
            <div>
              <span class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Page size</span>
              <select
                v-model.number="usersPageSize"
                class="w-full lg:w-28 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
                @change="usersPage = 1; loadUsers()"
              >
                <option :value="10">10</option>
                <option :value="25">25</option>
                <option :value="50">50</option>
              </select>
            </div>
          </div>
          <p class="text-xs text-gray-500 dark:text-gray-500">
            Showing {{ users.length ? (usersPage - 1) * usersPageSize + 1 : 0 }}–{{ Math.min(usersPage * usersPageSize, usersTotal) }} of {{ usersTotal }} users
          </p>
          <div class="space-y-2">
            <div
              v-for="u in users"
              :key="u.id"
              class="rounded-lg border border-gray-200 dark:border-gray-700 p-3 grid grid-cols-1 md:grid-cols-4 gap-2 items-center"
            >
              <div class="md:col-span-2">
                <p class="text-sm font-medium text-gray-900 dark:text-white">{{ u.email }}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400">{{ u.id }}</p>
                <button
                  v-if="userHasTransferableSubscription(u)"
                  type="button"
                  class="mt-1 text-xs font-medium text-purple-600 dark:text-purple-400 hover:underline"
                  @click="openTransferSubscriptionModal(u)"
                >
                  Transfer subscription…
                </button>
              </div>
              <div>
                <label class="sr-only" :for="`role-${u.id}`">Role for {{ u.email }}</label>
                <select
                  :id="`role-${u.id}`"
                  :value="adminUserRoleSelectValue(u)"
                  :disabled="user?.role !== 'super_admin' && u.role === 'super_admin'"
                  :title="user?.role !== 'super_admin' && u.role === 'super_admin' ? 'Only a super admin may change this account' : ''"
                  class="w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white disabled:opacity-50"
                  @change="(e) => onUserRoleSelect(u, (e.target as HTMLSelectElement).value)"
                >
                  <option value="viewer">viewer</option>
                  <option value="moderator">moderator</option>
                  <option value="analyst">analyst</option>
                  <option value="editor">editor</option>
                  <option value="admin">admin</option>
                  <option value="super_admin" :disabled="user?.role !== 'super_admin'">super_admin</option>
                </select>
              </div>
              <div>
                <label class="sr-only" :for="`sub-${u.id}`">Subscription for {{ u.email }}</label>
                <select
                  :id="`sub-${u.id}`"
                  :value="adminUserSubscriptionSelectValue(u)"
                  :disabled="adminUserSubscriptionSelectDisabled(u)"
                  :title="adminUserSubscriptionSelectTitle(u)"
                  class="w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white disabled:opacity-50"
                  @change="(e) => onUserSubscriptionSelect(u, (e.target as HTMLSelectElement).value)"
                >
                  <option value="none">none</option>
                  <template v-if="hasAdminUserSubscriptionRow(u)">
                    <option value="active">active</option>
                    <option value="trialing">trialing</option>
                    <option value="past_due">past_due</option>
                    <option value="cancelled">cancelled</option>
                    <option value="unpaid">unpaid</option>
                    <option value="incomplete">incomplete</option>
                  </template>
                </select>
              </div>
            </div>
            <p v-if="!users.length && !usersLoading" class="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">No users match these filters.</p>
            <p v-if="usersLoading" class="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">Loading…</p>
          </div>
          <div v-if="usersTotalPages > 1" class="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              class="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-sm disabled:opacity-40"
              :disabled="usersPage <= 1 || usersLoading"
              @click="usersPage = Math.max(1, usersPage - 1); loadUsers()"
            >
              Previous
            </button>
            <span class="text-sm text-gray-600 dark:text-gray-400">Page {{ usersPage }} / {{ usersTotalPages }}</span>
            <button
              type="button"
              class="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-sm disabled:opacity-40"
              :disabled="usersPage >= usersTotalPages || usersLoading"
              @click="usersPage = Math.min(usersTotalPages, usersPage + 1); loadUsers()"
            >
              Next
            </button>
          </div>
        </div>

        <div v-if="activeAdminTab === 'analytics'" id="analytics-panel" role="tabpanel" class="p-6 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 space-y-5">
          <h2 class="text-xl font-bold text-gray-900 dark:text-white">Analytics</h2>
          <p class="text-sm text-gray-600 dark:text-gray-400">Video retention, views over time, traffic sources, subscription trends, and cashflow estimates. Audience analytics run via Google Tag Manager.</p>
          <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <h3 class="font-semibold text-gray-900 dark:text-white">View counting strategy</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label class="text-xs text-gray-600 dark:text-gray-300 block">Min segments per session view
                <input v-model.number="analyticsViewCounting.minSegmentsPerSession" type="number" min="0" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
              </label>
              <label class="text-xs text-gray-600 dark:text-gray-300 block">Min watch seconds per session view
                <input v-model.number="analyticsViewCounting.minWatchSeconds" type="number" min="0" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
              </label>
            </div>
            <button type="button" class="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 text-sm text-gray-900 dark:text-white disabled:opacity-50" :disabled="analyticsSettingsSaving" @click="saveAnalyticsSettings">
              {{ analyticsSettingsSaving ? 'Saving…' : 'Save analytics settings' }}
            </button>
          </div>
          <div class="flex flex-wrap gap-2 items-end">
            <div class="flex flex-col gap-1">
              <label class="text-xs text-gray-500 dark:text-gray-400">Range</label>
              <select
                v-model="analyticsRange"
                class="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white"
                @change="loadAnalytics"
              >
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
                <option value="180d">Last 180 days</option>
                <option value="365d">Last 365 days</option>
              </select>
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-gray-500 dark:text-gray-400">Granularity</label>
              <select
                v-model="analyticsGranularity"
                class="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white"
                @change="loadAnalytics"
              >
                <option value="day">Daily</option>
                <option value="week">Weekly</option>
                <option value="month">Monthly</option>
              </select>
            </div>
            <button
              type="button"
              class="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 text-sm text-gray-900 dark:text-white disabled:opacity-50"
              :disabled="analyticsLoading"
              @click="loadAnalytics"
            >
              {{ analyticsLoading ? 'Refreshing…' : 'Refresh' }}
            </button>
            <button
              type="button"
              class="px-3 py-2 rounded border border-blue-300 dark:border-blue-700 text-sm text-blue-700 dark:text-blue-300 disabled:opacity-50"
              :disabled="!!analyticsExporting || analyticsLoading"
              @click="exportAnalytics('views')"
            >
              {{ analyticsExporting === 'views' ? 'Exporting…' : 'Export views CSV' }}
            </button>
            <button
              type="button"
              class="px-3 py-2 rounded border border-blue-300 dark:border-blue-700 text-sm text-blue-700 dark:text-blue-300 disabled:opacity-50"
              :disabled="!!analyticsExporting || analyticsLoading"
              @click="exportAnalytics('subscriptions')"
            >
              {{ analyticsExporting === 'subscriptions' ? 'Exporting…' : 'Export subs CSV' }}
            </button>
            <button
              type="button"
              class="px-3 py-2 rounded border border-blue-300 dark:border-blue-700 text-sm text-blue-700 dark:text-blue-300 disabled:opacity-50"
              :disabled="!!analyticsExporting || analyticsLoading"
              @click="exportAnalytics('retention')"
            >
              {{ analyticsExporting === 'retention' ? 'Exporting…' : 'Export retention CSV' }}
            </button>
          </div>
          <p v-if="analyticsError" class="text-sm text-red-600 dark:text-red-400">{{ analyticsError }}</p>
          <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
            <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-3" v-for="item in analyticsKpiCards" :key="item.key">
              <p class="text-xs text-gray-500 dark:text-gray-400">{{ item.label }}</p>
              <p class="text-2xl font-bold text-gray-900 dark:text-white">{{ item.value }}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ item.help }}</p>
            </div>
          </div>
          <div class="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <h3 class="font-semibold text-gray-900 dark:text-white mb-2">Views over time</h3>
              <div class="space-y-2">
                <div v-for="row in analyticsViewsSeriesChartRows" :key="`v-${row.bucket}`" class="space-y-1">
                  <div class="flex justify-between text-xs text-gray-600 dark:text-gray-300">
                    <span>{{ row.bucket }}</span>
                    <span>{{ row.value }}</span>
                  </div>
                  <div class="h-2 rounded bg-gray-100 dark:bg-gray-800">
                    <div class="h-2 rounded bg-blue-500" :style="{ width: `${row.percent}%` }"></div>
                  </div>
                </div>
                <p v-if="!analyticsViewsSeriesChartRows.length" class="text-sm text-gray-500 dark:text-gray-400">No data for selected range.</p>
              </div>
            </div>
            <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <h3 class="font-semibold text-gray-900 dark:text-white mb-2">Traffic source split</h3>
              <div class="space-y-2">
                <div v-for="row in analyticsTrafficChartRows" :key="`s-${row.source}`" class="space-y-1">
                  <div class="flex justify-between text-xs text-gray-600 dark:text-gray-300">
                    <span>{{ row.source }}</span>
                    <span>{{ row.value }}</span>
                  </div>
                  <div class="h-2 rounded bg-gray-100 dark:bg-gray-800">
                    <div class="h-2 rounded bg-emerald-500" :style="{ width: `${row.percent}%` }"></div>
                  </div>
                </div>
                <p v-if="!analyticsTrafficChartRows.length" class="text-sm text-gray-500 dark:text-gray-400">No source events for selected range.</p>
              </div>
            </div>
          </div>
          <div class="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-3 xl:col-span-2">
              <h3 class="font-semibold text-gray-900 dark:text-white mb-2">Published videos</h3>
              <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">Average max watch-through per qualified session. Videos without duration are excluded from retention averages.</p>
              <div class="overflow-x-auto">
                <table class="min-w-full text-sm">
                  <thead>
                    <tr class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                      <th class="py-2 pr-4">Title</th>
                      <th class="py-2 pr-4">Views</th>
                      <th class="py-2 pr-4">Avg retention</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in analyticsVideoStatsRows" :key="`vs-${row.videoId}`" class="border-b border-gray-100 dark:border-gray-800">
                      <td class="py-2 pr-4">
                        <a :href="videoWatchHref(row)" target="_blank" rel="noopener" class="text-blue-600 dark:text-blue-400 hover:underline">{{ row.title || row.videoId }}</a>
                      </td>
                      <td class="py-2 pr-4 text-gray-700 dark:text-gray-200">{{ row.viewCount }}</td>
                      <td class="py-2 pr-4 text-gray-700 dark:text-gray-200">{{ formatVideoRetention(row.averageRetentionPercent) }}</td>
                    </tr>
                    <tr v-if="!analyticsVideoStatsRows.length">
                      <td colspan="3" class="py-3 text-gray-500 dark:text-gray-400">No published videos.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <h3 class="font-semibold text-gray-900 dark:text-white mb-2">Subscription trends</h3>
              <div class="space-y-2">
                <div v-for="row in analyticsSubscriptionTrendRows" :key="`st-${row.bucket}`" class="rounded border border-gray-100 dark:border-gray-800 p-2">
                  <p class="text-xs text-gray-500 dark:text-gray-400">{{ row.bucket }}</p>
                  <p class="text-sm text-gray-700 dark:text-gray-200">New: {{ row.newSubscriptions }} · Churn: {{ row.churnedSubscriptions }} · Expiring: {{ row.expiringSubscriptions }}</p>
                </div>
                <p v-if="!analyticsSubscriptionTrendRows.length" class="text-sm text-gray-500 dark:text-gray-400">No subscription trend buckets in selected range.</p>
              </div>
            </div>
          </div>
          <div class="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <h3 class="font-semibold text-gray-900 dark:text-white mb-2">Subscription status breakdown</h3>
              <p v-for="row in analyticsStatusRows" :key="`ss-${row.status}`" class="text-sm text-gray-700 dark:text-gray-200">{{ row.status }}: {{ row.count }}</p>
              <p v-if="!analyticsStatusRows.length" class="text-sm text-gray-500 dark:text-gray-400">No active subscription rows found.</p>
            </div>
            <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <h3 class="font-semibold text-gray-900 dark:text-white mb-2">Cashflow trend (EUR est.)</h3>
              <div class="space-y-1">
                <p v-for="row in analyticsCashflowRows" :key="`cf-${row.bucket}`" class="text-sm text-gray-700 dark:text-gray-200">
                  {{ row.bucket }} · New €{{ row.estimatedNewRevenueEur.toFixed(2) }} · Net €{{ row.estimatedNetNewEur.toFixed(2) }}
                </p>
              </div>
              <p v-if="!analyticsCashflowRows.length" class="text-sm text-gray-500 dark:text-gray-400">No cashflow buckets for selected range.</p>
            </div>
          </div>
        </div>

        <div v-if="activeAdminTab === 'system'" id="system-panel" role="tabpanel" class="p-6 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 space-y-6">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="text-xl font-bold text-gray-900 dark:text-white">System</h2>
              <p class="text-sm text-gray-600 dark:text-gray-400">Operational controls, payments, and refresh actions.</p>
            </div>
            <button class="px-4 py-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-sm text-gray-900 dark:text-gray-100" @click="reloadAll">Reload data</button>
          </div>

          <div v-if="!isAdmin" class="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
            Only site administrators can edit payment gateway settings.
          </div>

          <template v-else>
            <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-4">
              <div>
                <h3 class="font-semibold text-gray-900 dark:text-white">Feature toggles</h3>
                <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">Enable/disable system modules and reveal their settings only when enabled.</p>
              </div>
              <div v-if="systemFeaturesMessage" class="rounded-lg border px-4 py-3 text-sm" :class="systemFeaturesMessageClass">{{ systemFeaturesMessage }}</div>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label class="inline-flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                  <input v-model="systemFeatures.promotionsEnabled" type="checkbox" class="rounded border-gray-300 dark:border-gray-600">
                  Promo codes
                </label>
                <label class="inline-flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                  <input v-model="systemFeatures.isicEnabled" type="checkbox" class="rounded border-gray-300 dark:border-gray-600">
                  ISIC API
                </label>
                <label class="inline-flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                  <input v-model="systemFeatures.freePodcastPreviewEnabled" type="checkbox" class="rounded border-gray-300 dark:border-gray-600">
                  Free podcast preview feed
                </label>
                <label class="inline-flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                  <input v-model="systemFeatures.videoUploaderEnabled" type="checkbox" class="rounded border-gray-300 dark:border-gray-600">
                  Video uploader (MediaConvert)
                </label>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
                  :disabled="systemFeaturesSaving"
                  @click="saveSystemFeatures"
                >
                  {{ systemFeaturesSaving ? 'Saving…' : 'Save feature toggles' }}
                </button>
              </div>
            </div>

            <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-4">
              <div>
                <h3 class="font-semibold text-gray-900 dark:text-white">Deno Postgres failover</h3>
                <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Push D1 changes to the Deno Deploy Postgres backup (users, subscriptions, videos, admin settings).
                </p>
              </div>
              <div v-if="replicationMessage" class="rounded-lg border px-4 py-3 text-sm" :class="replicationMessageClass">{{ replicationMessage }}</div>
              <p
                v-if="replicationStatus?.targetWarning"
                class="text-xs rounded-lg border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-100"
              >
                {{ replicationStatus.targetWarning }}
              </p>
              <p
                v-else-if="replicationStatus?.targetProbe && !replicationStatus.targetProbe.ok"
                class="text-xs rounded-lg border border-red-300 bg-red-50 text-red-800 px-3 py-2 dark:bg-red-950 dark:border-red-700 dark:text-red-200"
              >
                Ingest probe failed: {{ replicationStatus.targetProbe.error }}
              </p>
              <dl v-if="replicationStatus" class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-gray-700 dark:text-gray-300">
                <div><dt class="inline text-gray-500 dark:text-gray-400">Mode:</dt> <dd class="inline font-mono">{{ replicationStatus.mode }}</dd></div>
                <div>
                  <dt class="inline text-gray-500 dark:text-gray-400">Ingest target:</dt>
                  <dd class="inline">
                    {{ replicationStatus.targetConfigured ? (replicationStatus.targetProbe?.ok ? 'Reachable' : 'Configured') : 'Not configured' }}
                  </dd>
                </div>
                <div v-if="replicationStatus.targetResolvedPath" class="sm:col-span-2">
                  <dt class="inline text-gray-500 dark:text-gray-400">Ingest path:</dt>
                  <dd class="inline font-mono text-xs">{{ replicationStatus.targetResolvedPath }}</dd>
                </div>
                <div><dt class="inline text-gray-500 dark:text-gray-400">Batch size:</dt> <dd class="inline font-mono">{{ replicationStatus.batchSize }}</dd></div>
              </dl>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
                  :disabled="replicationResetting || replicationPushing || !replicationCanPush"
                  @click="pushReplicationToDeno"
                >
                  {{ replicationPushing ? 'Pushing…' : 'Push DB to Deno Postgres' }}
                </button>
                <button
                  type="button"
                  class="px-4 py-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-sm text-gray-900 dark:text-gray-100 disabled:opacity-50"
                  :disabled="replicationResetting || replicationPushing"
                  @click="() => loadReplicationStatus({ probe: true })"
                >
                  Refresh status
                </button>
                <button
                  type="button"
                  class="px-4 py-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-sm text-gray-900 dark:text-gray-100 disabled:opacity-50"
                  :disabled="replicationPushing || replicationResetting"
                  @click="resetReplicationCursors"
                >
                  {{ replicationResetting ? 'Resetting…' : 'Reset sync cursors' }}
                </button>
              </div>
              <p v-if="replicationStatus && !replicationStatus.targetConfigured" class="text-xs text-amber-700 dark:text-amber-300">
                Set <code class="font-mono">REPLICATION_TARGET_URL</code> to your <strong>Deno Deploy api-node</strong> URL (ending in <code class="font-mono">/api/internal/replication/ingest</code>) and <code class="font-mono">REPLICATION_TARGET_TOKEN</code> on the Cloudflare Worker. Do not use the Workers API URL.
              </p>
            </div>

            <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-4">
              <div>
                <h3 class="font-semibold text-gray-900 dark:text-white">AWS MediaConvert + TUS</h3>
                <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">Manage MediaConvert credentials and TUS resumable upload endpoint for source ingest.</p>
              </div>
              <div v-if="mediaConvertSystemMessage" class="rounded-lg border px-4 py-3 text-sm" :class="mediaConvertSystemMessageClass">{{ mediaConvertSystemMessage }}</div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label class="block text-sm text-gray-700 dark:text-gray-300">
                  <span class="inline-flex items-center gap-2">
                    <input v-model="mediaConvertSystem.enabled" type="checkbox" class="rounded border-gray-300 dark:border-gray-600">
                    MediaConvert pipeline enabled
                  </span>
                </label>
                <label class="block text-sm text-gray-700 dark:text-gray-300">
                  AWS region
                  <input v-model="mediaConvertSystem.awsRegion" type="text" placeholder="eu-central-1" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                </label>
                <label class="block text-sm text-gray-700 dark:text-gray-300">
                  AWS access key ID
                  <input v-model="mediaConvertSystem.awsAccessKeyId" type="text" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs" />
                </label>
                <label class="block text-sm text-gray-700 dark:text-gray-300">
                  AWS secret access key
                  <input v-model="mediaConvertSystem.awsSecretAccessKey" type="password" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs" />
                  <p v-if="mediaConvertSystem.hasAwsSecret" class="mt-1 text-xs text-gray-500 dark:text-gray-400">Configured. Enter a new value to rotate.</p>
                </label>
                <label class="block text-sm text-gray-700 dark:text-gray-300">
                  AWS session token (optional)
                  <input v-model="mediaConvertSystem.awsSessionToken" type="password" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs" />
                  <p v-if="mediaConvertSystem.hasAwsSession" class="mt-1 text-xs text-gray-500 dark:text-gray-400">Configured. Enter a new value to rotate.</p>
                </label>
                <label class="block text-sm text-gray-700 dark:text-gray-300">
                  MediaConvert endpoint
                  <input v-model="mediaConvertSystem.endpoint" type="url" placeholder="https://abcd.mediaconvert.eu-central-1.amazonaws.com" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs" />
                </label>
                <label class="block text-sm text-gray-700 dark:text-gray-300 md:col-span-2">
                  MediaConvert role ARN
                  <input v-model="mediaConvertSystem.roleArn" type="text" placeholder="arn:aws:iam::123456789012:role/MediaConvertRole" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs" />
                </label>
                <label class="block text-sm text-gray-700 dark:text-gray-300">
                  Input bucket
                  <input v-model="mediaConvertSystem.inputBucket" type="text" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                </label>
                <label class="block text-sm text-gray-700 dark:text-gray-300">
                  Output bucket
                  <input v-model="mediaConvertSystem.outputBucket" type="text" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                </label>
                <label class="block text-sm text-gray-700 dark:text-gray-300">
                  Input prefix
                  <input v-model="mediaConvertSystem.inputPrefix" type="text" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs" />
                </label>
                <label class="block text-sm text-gray-700 dark:text-gray-300">
                  Output prefix
                  <input v-model="mediaConvertSystem.outputPrefix" type="text" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs" />
                </label>
                <label class="block text-sm text-gray-700 dark:text-gray-300 md:col-span-2">
                  TUS endpoint
                  <input v-model="mediaConvertSystem.tusEndpoint" type="url" placeholder="https://tus.your-domain.example/files" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs" />
                </label>
                <label class="block text-sm text-gray-700 dark:text-gray-300 md:col-span-2">
                  TUS auth token (optional)
                  <input v-model="mediaConvertSystem.tusAuthToken" type="password" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs" />
                  <p v-if="mediaConvertSystem.hasTusAuth" class="mt-1 text-xs text-gray-500 dark:text-gray-400">Configured. Enter a new value to rotate.</p>
                </label>
              </div>
              <div class="flex flex-wrap gap-2">
                <button type="button" class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50" :disabled="mediaConvertSystemSaving" @click="saveMediaConvertSystemSettings">
                  {{ mediaConvertSystemSaving ? 'Saving…' : 'Save MediaConvert settings' }}
                </button>
              </div>
            </div>

            <!-- Site Branding -->
            <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-4">
              <div>
                <h3 class="font-semibold text-gray-900 dark:text-white">Site branding</h3>
                <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Configure site name, description, logo, and favicon. These propagate to the header, page title, podcast feed, and PWA manifest.
                </p>
              </div>
              <div v-if="siteBrandingMessage" class="rounded-lg border px-4 py-3 text-sm" :class="siteBrandingMessageClass">{{ siteBrandingMessage }}</div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label class="block text-sm text-gray-700 dark:text-gray-300">
                  Site name
                  <input v-model="siteBranding.site_name" type="text" placeholder="My Platform" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                </label>
                <label class="block text-sm text-gray-700 dark:text-gray-300">
                  Short name (header mobile)
                  <input v-model="siteBranding.site_name_short" type="text" placeholder="VMP" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                </label>
                <label class="block text-sm text-gray-700 dark:text-gray-300 md:col-span-2">
                  Site description
                  <input v-model="siteBranding.site_description" type="text" placeholder="Premium video content platform" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                </label>
                <label class="block text-sm text-gray-700 dark:text-gray-300">
                  Logo URL
                  <input v-model="siteBranding.site_logo_url" type="url" placeholder="https://..." class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs" />
                </label>
                <label class="block text-sm text-gray-700 dark:text-gray-300">
                  Favicon URL
                  <input v-model="siteBranding.site_favicon_url" type="url" placeholder="https://..." class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs" />
                </label>
                <label class="block text-sm text-gray-700 dark:text-gray-300">
                  Podcast feed title
                  <input v-model="siteBranding.podcast_title" type="text" placeholder="My Podcast" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                </label>
                <label class="block text-sm text-gray-700 dark:text-gray-300">
                  Podcast feed description
                  <input v-model="siteBranding.podcast_description" type="text" placeholder="Episodes from my show" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                </label>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
                  :disabled="siteBrandingSaving"
                  @click="saveSiteBranding"
                >
                  {{ siteBrandingSaving ? 'Saving…' : 'Save branding' }}
                </button>
              </div>
            </div>

            <div v-if="paymentSettingsMessage" class="rounded-lg border px-4 py-3 text-sm" :class="paymentSettingsMessageClass">{{ paymentSettingsMessage }}</div>

            <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-4">
              <h3 class="font-semibold text-gray-900 dark:text-white">Payments</h3>
              <p class="text-sm text-gray-600 dark:text-gray-400">
                Configure which gateways appear at checkout, per-gateway prices shown in the premium overlay, and Stripe price IDs used for Stripe Checkout.
              </p>

              <div class="flex flex-wrap gap-4">
                <label class="inline-flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                  <input v-model="paymentSettings.enabledProviders" type="checkbox" value="stripe" class="rounded border-gray-300 dark:border-gray-600">
                  Stripe (card)
                </label>
                <label class="inline-flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                  <input v-model="paymentSettings.enabledProviders" type="checkbox" value="gocardless" class="rounded border-gray-300 dark:border-gray-600">
                  GoCardless (bank debit)
                </label>
              </div>

              <div>
                <p class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Primary checkout provider</p>
                <div class="flex flex-wrap gap-3 items-end">
                  <label class="text-sm text-gray-700 dark:text-gray-300">Primary
                    <select v-model="paymentPrimaryProvider" class="mt-1 block px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                      <option value="stripe">Stripe</option>
                      <option value="gocardless">GoCardless</option>
                    </select>
                  </label>
                  <p class="text-xs text-gray-500 dark:text-gray-400">The primary provider is shown first at checkout.</p>
                </div>
              </div>

              <div>
                <p class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Plans offered</p>
                <div class="flex flex-wrap gap-4">
                  <label class="inline-flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                    <input v-model="paymentSettings.allowedPlans" type="checkbox" value="monthly" class="rounded border-gray-300 dark:border-gray-600">
                    Monthly
                  </label>
                  <label class="inline-flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                    <input v-model="paymentSettings.allowedPlans" type="checkbox" value="yearly" class="rounded border-gray-300 dark:border-gray-600">
                    Yearly
                  </label>
                  <label class="inline-flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                    <input v-model="paymentSettings.allowedPlans" type="checkbox" value="club" class="rounded border-gray-300 dark:border-gray-600">
                    Club
                  </label>
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="space-y-2">
                  <h4 class="text-sm font-semibold text-gray-900 dark:text-white">Fallback prices (EUR)</h4>
                  <p class="text-xs text-gray-500 dark:text-gray-400">Used when a provider-specific price is empty.</p>
                  <div class="grid grid-cols-3 gap-2">
                    <label class="text-xs text-gray-600 dark:text-gray-300">Monthly
                      <input v-model="paymentSettings.basePrices.monthly" type="text" inputmode="decimal" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" placeholder="e.g. 6.90">
                    </label>
                    <label class="text-xs text-gray-600 dark:text-gray-300">Yearly
                      <input v-model="paymentSettings.basePrices.yearly" type="text" inputmode="decimal" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" placeholder="e.g. 74.90">
                    </label>
                    <label class="text-xs text-gray-600 dark:text-gray-300">Club
                      <input v-model="paymentSettings.basePrices.club" type="text" inputmode="decimal" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" placeholder="e.g. 109.00">
                    </label>
                  </div>
                </div>
                <div v-if="paymentSettings.enabledProviders.includes('stripe')" class="space-y-2">
                  <h4 class="text-sm font-semibold text-gray-900 dark:text-white">Stripe price IDs</h4>
                  <p class="text-xs text-gray-500 dark:text-gray-400">From Stripe Dashboard → Products → Price IDs.</p>
                  <label class="text-xs text-gray-600 dark:text-gray-300 block">Monthly price ID
                    <input v-model="paymentSettings.stripePriceIds.monthly" type="text" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs" placeholder="price_...">
                  </label>
                  <label class="text-xs text-gray-600 dark:text-gray-300 block">Yearly price ID
                    <input v-model="paymentSettings.stripePriceIds.yearly" type="text" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs" placeholder="price_...">
                  </label>
                  <label class="text-xs text-gray-600 dark:text-gray-300 block">Club price ID
                    <input v-model="paymentSettings.stripePriceIds.club" type="text" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs" placeholder="price_...">
                  </label>
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div v-if="paymentSettings.enabledProviders.includes('stripe')" class="rounded-lg border border-gray-100 dark:border-gray-800 p-3 space-y-2">
                  <h4 class="text-sm font-semibold text-gray-900 dark:text-white">Stripe display prices (EUR)</h4>
                  <div class="grid grid-cols-3 gap-2">
                    <label class="text-xs text-gray-600 dark:text-gray-300">Monthly
                      <input v-model="paymentSettings.providerPrices.stripe.monthly" type="text" inputmode="decimal" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                    </label>
                    <label class="text-xs text-gray-600 dark:text-gray-300">Yearly
                      <input v-model="paymentSettings.providerPrices.stripe.yearly" type="text" inputmode="decimal" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                    </label>
                    <label class="text-xs text-gray-600 dark:text-gray-300">Club
                      <input v-model="paymentSettings.providerPrices.stripe.club" type="text" inputmode="decimal" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                    </label>
                  </div>
                </div>
                <div v-if="paymentSettings.enabledProviders.includes('gocardless')" class="rounded-lg border border-gray-100 dark:border-gray-800 p-3 space-y-2">
                  <h4 class="text-sm font-semibold text-gray-900 dark:text-white">GoCardless display prices (EUR)</h4>
                  <div class="grid grid-cols-3 gap-2">
                    <label class="text-xs text-gray-600 dark:text-gray-300">Monthly
                      <input v-model="paymentSettings.providerPrices.gocardless.monthly" type="text" inputmode="decimal" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                    </label>
                    <label class="text-xs text-gray-600 dark:text-gray-300">Yearly
                      <input v-model="paymentSettings.providerPrices.gocardless.yearly" type="text" inputmode="decimal" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                    </label>
                    <label class="text-xs text-gray-600 dark:text-gray-300">Club
                      <input v-model="paymentSettings.providerPrices.gocardless.club" type="text" inputmode="decimal" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                    </label>
                  </div>
                </div>
              </div>

              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
                  :disabled="paymentSettingsSaving"
                  @click="savePaymentSettings"
                >
                  {{ paymentSettingsSaving ? 'Saving…' : 'Save payment settings' }}
                </button>
              </div>
            </div>

            <div v-if="systemFeatures.promotionsEnabled" class="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-4">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h3 class="font-semibold text-gray-900 dark:text-white">Promo campaigns & codes</h3>
                  <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    Manage single-use and multi-use promo codes for free month/year or provider-specific percentage discounts.
                  </p>
                </div>
                <button
                  type="button"
                  class="px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm font-semibold disabled:opacity-50"
                  :disabled="promotionsLoading"
                  @click="loadPromotions"
                >
                  {{ promotionsLoading ? 'Loading…' : 'Reload promotions' }}
                </button>
              </div>

              <div v-if="promotionsMessage" class="rounded-lg border px-3 py-2 text-sm" :class="promotionsMessageClass">
                {{ promotionsMessage }}
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="space-y-2">
                  <h4 class="text-sm font-semibold text-gray-900 dark:text-white">Create campaign</h4>
                  <label class="text-xs text-gray-600 dark:text-gray-300 block">Campaign name
                    <input v-model="promoCampaignForm.name" type="text" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" placeholder="e.g. Acme Corp 2026">
                  </label>
                  <label class="text-xs text-gray-600 dark:text-gray-300 block">Description
                    <textarea v-model="promoCampaignForm.description" rows="2" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" placeholder="Optional notes" />
                  </label>
                  <label class="inline-flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                    <input v-model="promoCampaignForm.isActive" type="checkbox" class="rounded border-gray-300 dark:border-gray-600">
                    Active
                  </label>
                  <button
                    type="button"
                    class="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
                    :disabled="promotionsSaving || !promoCampaignForm.name.trim()"
                    @click="createPromoCampaign"
                  >
                    {{ promotionsSaving ? 'Saving…' : 'Create campaign' }}
                  </button>
                </div>

                <div class="space-y-2">
                  <h4 class="text-sm font-semibold text-gray-900 dark:text-white">Create promo code(s)</h4>
                  <label class="text-xs text-gray-600 dark:text-gray-300 block">Campaign
                    <select v-model="promoCodeForm.campaignId" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                      <option value="">Select campaign…</option>
                      <option v-for="c in promoCampaigns" :key="c.id" :value="c.id">{{ c.name }}</option>
                    </select>
                  </label>
                  <div class="grid grid-cols-2 gap-2">
                    <label class="text-xs text-gray-600 dark:text-gray-300 block">Code prefix (optional)
                      <input v-model="promoCodeForm.code" type="text" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono" placeholder="ACME">
                    </label>
                    <label class="text-xs text-gray-600 dark:text-gray-300 block">How many codes
                      <input v-model.number="promoCodeForm.quantity" type="number" min="1" max="200" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                    </label>
                  </div>
                  <div class="grid grid-cols-2 gap-2">
                    <label class="text-xs text-gray-600 dark:text-gray-300 block">Reward type
                      <select v-model="promoCodeForm.rewardType" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                        <option value="free_month">Free month</option>
                        <option value="free_year">Free year</option>
                        <option value="discount_percent">Discount % (Stripe coupon)</option>
                      </select>
                    </label>
                    <label class="text-xs text-gray-600 dark:text-gray-300 block">Max uses per code
                      <input v-model.number="promoCodeForm.maxUses" type="number" min="1" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                    </label>
                  </div>
                  <label class="text-xs text-gray-600 dark:text-gray-300 block">Allowed plans
                    <div class="mt-1 flex flex-wrap gap-3">
                      <label class="inline-flex items-center gap-2 text-xs"><input v-model="promoCodeForm.allowedPlanTypes" type="checkbox" value="monthly" class="rounded border-gray-300 dark:border-gray-600">Monthly</label>
                      <label class="inline-flex items-center gap-2 text-xs"><input v-model="promoCodeForm.allowedPlanTypes" type="checkbox" value="yearly" class="rounded border-gray-300 dark:border-gray-600">Yearly</label>
                      <label class="inline-flex items-center gap-2 text-xs"><input v-model="promoCodeForm.allowedPlanTypes" type="checkbox" value="club" class="rounded border-gray-300 dark:border-gray-600">Club</label>
                    </div>
                  </label>
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div class="rounded-lg border border-gray-100 dark:border-gray-800 p-3 space-y-2">
                      <h5 class="text-xs font-semibold text-gray-800 dark:text-gray-100">Stripe promo mapping</h5>
                      <label class="text-xs text-gray-600 dark:text-gray-300 block">Stripe coupon ID
                        <input
                          v-model="promoCodeForm.stripeCouponId"
                          type="text"
                          class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs"
                          placeholder="coupon_..."
                        >
                      </label>
                    </div>
                    <div class="rounded-lg border border-gray-100 dark:border-gray-800 p-3 space-y-2">
                      <h5 class="text-xs font-semibold text-gray-800 dark:text-gray-100">GoCardless promo mapping</h5>
                      <label class="text-xs text-gray-600 dark:text-gray-300 block">Discount percent
                        <input
                          v-model="promoCodeForm.gocardlessDiscountPercent"
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-xs"
                          placeholder="10"
                        >
                      </label>
                      <label class="text-xs text-gray-600 dark:text-gray-300 block">Plan code (optional)
                        <input
                          v-model="promoCodeForm.gocardlessPlanCode"
                          type="text"
                          class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs"
                          placeholder="ALT-MONTHLY"
                        >
                      </label>
                    </div>
                  </div>
                  <label class="text-xs text-gray-600 dark:text-gray-300 block">Expires at (optional)
                    <input v-model="promoCodeForm.expiresAt" type="datetime-local" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                  </label>
                  <button
                    type="button"
                    class="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
                    :disabled="promotionsSaving || !promoCodeForm.campaignId"
                    @click="createPromoCodes"
                  >
                    {{ promotionsSaving ? 'Saving…' : 'Create code(s)' }}
                  </button>
                </div>
              </div>

              <div class="rounded-lg border border-gray-100 dark:border-gray-800 p-3">
                <h4 class="text-sm font-semibold text-gray-900 dark:text-white mb-2">Existing promo codes</h4>
                <p v-if="!promoCodes.length" class="text-sm text-gray-500 dark:text-gray-400">No promo codes yet.</p>
                <div v-else class="overflow-x-auto">
                  <table class="min-w-full text-sm">
                    <thead class="text-left text-gray-500 dark:text-gray-400">
                      <tr>
                        <th class="py-1 pr-3">Code</th>
                        <th class="py-1 pr-3">Campaign</th>
                        <th class="py-1 pr-3">Reward</th>
                        <th class="py-1 pr-3">Provider mappings</th>
                        <th class="py-1 pr-3">Usage</th>
                        <th class="py-1 pr-3">Plans</th>
                        <th class="py-1 pr-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="code in promoCodes" :key="code.id" class="border-t border-gray-100 dark:border-gray-800">
                        <td class="py-2 pr-3 font-mono text-xs text-gray-900 dark:text-gray-100">{{ code.code }}</td>
                        <td class="py-2 pr-3 text-gray-800 dark:text-gray-200">{{ code.campaign_name || '—' }}</td>
                        <td class="py-2 pr-3 text-gray-800 dark:text-gray-200">{{ code.reward_type }}</td>
                        <td class="py-2 pr-3 text-gray-700 dark:text-gray-300">
                          <div class="space-y-1 text-xs">
                            <p>Stripe: {{ code.stripe_coupon_id || '—' }}</p>
                            <p>GoCardless: {{ code.gocardless_discount_percent != null ? `${code.gocardless_discount_percent}%` : '—' }}</p>
                            <p>GoCardless plan: {{ code.gocardlessPlanCode || code.gocardless_plan_code || '—' }}</p>
                          </div>
                        </td>
                        <td class="py-2 pr-3 text-gray-800 dark:text-gray-200">{{ code.used_count }} / {{ code.max_uses }}</td>
                        <td class="py-2 pr-3 text-gray-800 dark:text-gray-200">{{ code.allowed_plan_types }}</td>
                        <td class="py-2 pr-3 text-gray-800 dark:text-gray-200">{{ code.is_active ? 'Active' : 'Inactive' }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div v-if="systemFeatures.isicEnabled" class="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-4">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h3 class="font-semibold text-gray-900 dark:text-white">ISIC campaigns</h3>
                  <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    Configure CZ/SK ISIC-based campaigns and API connection placeholders until production keys are available.
                  </p>
                </div>
                <button
                  type="button"
                  class="px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm font-semibold disabled:opacity-50"
                  :disabled="isicLoading"
                  @click="loadIsicCampaigns"
                >
                  {{ isicLoading ? 'Loading…' : 'Reload ISIC' }}
                </button>
              </div>

              <div v-if="isicMessage" class="rounded-lg border px-3 py-2 text-sm" :class="isicMessageClass">
                {{ isicMessage }}
              </div>

              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label class="text-xs text-gray-600 dark:text-gray-300 block">Enable ISIC API
                  <div class="mt-1">
                    <input v-model="isicApiConfig.enabled" type="checkbox" class="rounded border-gray-300 dark:border-gray-600">
                  </div>
                </label>
                <label class="text-xs text-gray-600 dark:text-gray-300 block md:col-span-2">API base URL
                  <input v-model="isicApiConfig.baseUrl" type="url" placeholder="https://alive.example.com/api" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs">
                </label>
              </div>
              <label class="text-xs text-gray-600 dark:text-gray-300 block">API key (stored in admin_settings until secrets are available)
                <input v-model="isicApiConfig.apiKey" type="password" placeholder="Paste key" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs">
              </label>
              <button
                type="button"
                class="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
                :disabled="isicSaving"
                @click="saveIsicApiConfig"
              >
                {{ isicSaving ? 'Saving…' : 'Save ISIC API config' }}
              </button>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="space-y-2">
                  <h4 class="text-sm font-semibold text-gray-900 dark:text-white">Create ISIC campaign</h4>
                  <label class="text-xs text-gray-600 dark:text-gray-300 block">Name
                    <input v-model="isicCampaignForm.name" type="text" placeholder="Students 5000 free slots" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                  </label>
                  <label class="text-xs text-gray-600 dark:text-gray-300 block">Description
                    <textarea v-model="isicCampaignForm.description" rows="2" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                  </label>
                  <div class="grid grid-cols-2 gap-2">
                    <label class="text-xs text-gray-600 dark:text-gray-300 block">Free slots limit
                      <input v-model.number="isicCampaignForm.freeSlotsLimit" type="number" min="0" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                    </label>
                    <label class="text-xs text-gray-600 dark:text-gray-300 block">Discount percent
                      <input v-model.number="isicCampaignForm.discountPercent" type="number" min="0" max="100" step="0.1" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                    </label>
                  </div>
                  <div class="grid grid-cols-2 gap-2">
                    <label class="text-xs text-gray-600 dark:text-gray-300 block">Renewal months
                      <input v-model.number="isicCampaignForm.renewalMonths" type="number" min="1" max="36" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                    </label>
                    <label class="text-xs text-gray-600 dark:text-gray-300 block">Popup behavior
                      <select v-model="isicCampaignForm.popupBehavior" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                        <option value="default">Default</option>
                        <option value="highlight_campaign">Highlight campaign</option>
                        <option value="hide_standard">Hide standard plans</option>
                        <option value="isic_first">ISIC first</option>
                      </select>
                    </label>
                  </div>
                  <label class="text-xs text-gray-600 dark:text-gray-300 block">Country scope
                    <input v-model="isicCampaignForm.countryScope" type="text" placeholder="CZ,SK" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                  </label>
                  <label class="inline-flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                    <input v-model="isicCampaignForm.isActive" type="checkbox" class="rounded border-gray-300 dark:border-gray-600">
                    Active
                  </label>
                  <button
                    type="button"
                    class="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
                    :disabled="isicSaving || !isicCampaignForm.name.trim()"
                    @click="createIsicCampaign"
                  >
                    {{ isicSaving ? 'Saving…' : 'Create ISIC campaign' }}
                  </button>
                </div>

                <div class="space-y-2">
                  <h4 class="text-sm font-semibold text-gray-900 dark:text-white">Active ISIC campaigns</h4>
                  <p v-if="!isicCampaigns.length" class="text-sm text-gray-500 dark:text-gray-400">No ISIC campaigns yet.</p>
                  <div v-else class="space-y-2">
                    <div v-for="campaign in isicCampaigns" :key="campaign.id" class="rounded border border-gray-100 dark:border-gray-800 p-3">
                      <p class="font-medium text-gray-900 dark:text-white">{{ campaign.name }}</p>
                      <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Slots: {{ campaign.free_slots_limit }} · Discount: {{ campaign.discount_percent }}% · Renewal: {{ campaign.renewal_months }} months
                      </p>
                      <p class="text-xs text-gray-500 dark:text-gray-400">Behavior: {{ campaign.popup_behavior }} · Scope: {{ campaign.country_scope }}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="systemFeatures.freePodcastPreviewEnabled" class="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-4">
              <div>
                <h3 class="font-semibold text-gray-900 dark:text-white">Podcast preview (RSS)</h3>
                <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  The public feed prefers HLS or a pre-cut
                  <code class="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">podcast_preview.mp3</code>
                  so preview length tracks your preview duration without waiting on ffmpeg. After you change preview durations, notify your media host to re-encode preview MP3s if you use them.
                </p>
              </div>

              <div v-if="rssPodcastMessage" class="rounded-lg border px-4 py-3 text-sm" :class="rssPodcastMessageClass">{{ rssPodcastMessage }}</div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label class="block text-sm text-gray-700 dark:text-gray-300 md:col-span-2">
                  Rebuild webhook URL (your host / tunnel)
                  <input
                    v-model="rssPodcastWebhookUrl"
                    type="url"
                    placeholder="https://media.example.internal:8788/vmp/api/podcast-preview-rebuild"
                    class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs"
                  >
                </label>
                <label class="block text-sm text-gray-700 dark:text-gray-300 md:col-span-2">
                  Shared secret (HMAC-SHA256 of JSON body; min 16 chars)
                  <input
                    v-model="rssPodcastWebhookSecretInput"
                    type="password"
                    autocomplete="new-password"
                    placeholder="Leave blank to keep current secret"
                    class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs"
                  >
                </label>
              </div>

              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm font-semibold disabled:opacity-50"
                  :disabled="rssPodcastWebhookSaving"
                  @click="saveRssPodcastWebhookSettings"
                >
                  {{ rssPodcastWebhookSaving ? 'Saving…' : 'Save webhook settings' }}
                </button>
                <button
                  type="button"
                  class="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold disabled:opacity-50"
                  :disabled="rssPodcastNotifySending"
                  @click="notifyPodcastPreviewRebuild"
                >
                  {{ rssPodcastNotifySending ? 'Notifying…' : 'Notify host to re-render preview podcasts' }}
                </button>
              </div>
              <p v-if="rssPodcastSecretConfigured" class="text-xs text-gray-500 dark:text-gray-400">A webhook secret is configured on the server.</p>
            </div>
          </template>
        </div>
      </section>

    </main>

    <div class="fixed top-20 right-4 z-50 space-y-2">
      <div v-for="toast in toasts" :key="toast.id" role="status" aria-live="polite" aria-atomic="true" class="rounded-lg border px-3 py-2 text-sm shadow" :class="toast.type === 'success' ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200'">{{ toast.message }}</div>
    </div>

    <div v-if="confirmModal.open" class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" @click.self="onConfirmCancel">
      <div
        ref="confirmDialogRef"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmModalTitle"
        aria-describedby="confirmModalDesc"
        tabindex="-1"
        class="w-full max-w-lg rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5"
      >
        <h3 id="confirmModalTitle" class="text-lg font-semibold text-gray-900 dark:text-white mb-2">{{ confirmModalTitle }}</h3>
        <p id="confirmModalDesc" class="text-sm text-gray-600 dark:text-gray-400 mb-4">{{ confirmModal.impactText }}</p>
        <div class="flex justify-end gap-2">
          <button type="button" aria-label="Cancel" class="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 text-sm" @click="onConfirmCancel">Cancel</button>
          <button
            type="button"
            aria-label="Confirm"
            class="px-3 py-2 rounded text-sm text-white"
            :class="confirmModalConfirmClass"
            @click="runConfirmedAction"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>

    <div v-if="livestreamModal.open" class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" @click.self="closeLivestreamModal">
      <div class="w-full max-w-2xl rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Create livestream video</h3>
            <p class="text-sm text-gray-600 dark:text-gray-400">Creates a standard video row configured for MoQ playback (endpoint + broadcast name).</p>
          </div>
          <button class="text-sm text-gray-600 dark:text-gray-300 hover:underline" @click="closeLivestreamModal">Close</button>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label class="text-sm text-gray-700 dark:text-gray-300">Title
            <input v-model="livestreamModal.form.title" type="text" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
          </label>
          <label class="text-sm text-gray-700 dark:text-gray-300">Slug (optional)
            <input v-model="livestreamModal.form.slug" type="text" placeholder="my-livestream" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
          </label>
          <label class="text-sm text-gray-700 dark:text-gray-300">Initial stream status
            <select v-model="livestreamModal.form.status" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
              <option value="draft">draft</option>
              <option value="ready">ready</option>
              <option value="live">live</option>
            </select>
          </label>
          <label class="text-sm text-gray-700 dark:text-gray-300">Publish status
            <select v-model="livestreamModal.form.publishStatus" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
              <option value="draft">draft</option>
              <option value="published">published</option>
            </select>
          </label>
          <label class="text-sm text-gray-700 dark:text-gray-300 md:col-span-2">Description
            <textarea v-model="livestreamModal.form.description" rows="2" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"></textarea>
          </label>
          <label class="text-sm text-gray-700 dark:text-gray-300">MoQ endpoint URL
            <input
              v-model="livestreamModal.form.moqEndpoint"
              type="url"
              placeholder="https://cdn.moq.dev/anon"
              class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
          </label>
          <label class="text-sm text-gray-700 dark:text-gray-300">MoQ broadcast name
            <input
              v-model="livestreamModal.form.moqBroadcast"
              type="text"
              placeholder="obstesting123"
              class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
          </label>
        </div>
        <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">The watch page will use these MoQ fields directly for livestream playback.</p>
        <p v-if="livestreamModal.error" class="mt-3 text-sm text-red-600 dark:text-red-300">{{ livestreamModal.error }}</p>
        <div class="mt-4 flex justify-end gap-2">
          <button class="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 text-sm" @click="closeLivestreamModal">Cancel</button>
          <button
            class="px-3 py-2 rounded bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold disabled:opacity-50"
            :disabled="livestreamModal.saving"
            @click="createLivestream"
          >
            {{ livestreamModal.saving ? 'Creating…' : 'Create livestream' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Schedule modal -->
    <div v-if="scheduleModal.open" class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" @click.self="closeScheduleModal">
      <div
        ref="scheduleDialogRef"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scheduleModalTitle"
        tabindex="-1"
        class="w-full max-w-lg rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5"
      >
        <div class="flex items-center justify-between mb-4">
          <div>
            <h3 id="scheduleModalTitle" class="text-lg font-semibold text-gray-900 dark:text-white">Schedule</h3>
            <p class="text-sm text-gray-600 dark:text-gray-400 line-clamp-1">{{ scheduleModalVideo?.title || 'Video' }}</p>
          </div>
          <button class="text-sm text-gray-600 dark:text-gray-300 hover:underline" @click="closeScheduleModal">Close</button>
        </div>
        <div v-if="scheduleModalVideo" class="space-y-4">
          <div class="space-y-1">
            <label class="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Upload date</label>
            <input
              v-model="scheduleModal.uploadDate"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              :placeholder="scheduleInputPlaceholder"
              class="w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white font-mono"
              :disabled="statusUpdating[scheduleModalVideo.id]"
            />
            <button
              type="button"
              class="px-2 py-1 text-xs rounded bg-gray-700 hover:bg-gray-600 text-white font-medium disabled:opacity-50"
              :disabled="statusUpdating[scheduleModalVideo.id]"
              @click="applyUploadDateFromScheduleModal(scheduleModalVideo)"
            >Apply upload date</button>
          </div>
          <div class="space-y-1">
            <label class="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Scheduled publish date</label>
            <input
              v-model="scheduleModal.scheduleDate"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              :placeholder="scheduleInputPlaceholder"
              class="w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white font-mono"
              :disabled="statusUpdating[scheduleModalVideo.id]"
            />
            <div class="flex gap-2">
              <button
                type="button"
                class="px-2 py-1 text-xs rounded bg-sky-600 hover:bg-sky-700 text-white font-medium disabled:opacity-50"
                :disabled="statusUpdating[scheduleModalVideo.id]"
                @click="applyScheduleFromModal(scheduleModalVideo)"
              >Apply schedule</button>
              <button
                type="button"
                class="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-50"
                :disabled="statusUpdating[scheduleModalVideo.id]"
                @click="clearScheduleFromModal(scheduleModalVideo)"
              >Clear schedule</button>
            </div>
          </div>
          <div class="space-y-1">
            <label class="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Published date</label>
            <input
              v-model="scheduleModal.publishedDate"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              :placeholder="scheduleInputPlaceholder"
              class="w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white font-mono"
              :disabled="statusUpdating[scheduleModalVideo.id]"
            />
            <div class="flex gap-2">
              <button
                type="button"
                class="px-2 py-1 text-xs rounded bg-sky-600 hover:bg-sky-700 text-white font-medium disabled:opacity-50"
                :disabled="statusUpdating[scheduleModalVideo.id]"
                @click="applyPublishedAtFromModal(scheduleModalVideo)"
              >Apply date</button>
              <button
                type="button"
                class="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-50"
                :disabled="statusUpdating[scheduleModalVideo.id]"
                @click="clearPublishedDateFromModal(scheduleModalVideo)"
              >Clear publish date</button>
            </div>
          </div>
        </div>
        <div class="mt-4 flex justify-end">
          <button type="button" class="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 text-sm" @click="closeScheduleModal">Done</button>
        </div>
      </div>
    </div>

    <!-- Description modal -->
    <div v-if="descriptionModal.open" class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" @click.self="closeDescriptionModal">
      <div
        ref="descriptionDialogRef"
        role="dialog"
        aria-modal="true"
        aria-labelledby="descriptionModalTitle"
        tabindex="-1"
        class="w-full max-w-3xl rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5"
      >
        <div class="flex items-center justify-between mb-4">
          <div>
            <h3 id="descriptionModalTitle" class="text-lg font-semibold text-gray-900 dark:text-white">Edit description</h3>
            <p class="text-sm text-gray-600 dark:text-gray-400 line-clamp-1">{{ descriptionModal.title }}</p>
          </div>
          <button class="text-sm text-gray-600 dark:text-gray-300 hover:underline" @click="closeDescriptionModal">Close</button>
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Markdown</label>
            <textarea
              ref="descriptionInputEl"
              v-model="descriptionModal.value"
              rows="14"
              class="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white font-mono"
              placeholder="Use markdown: **bold**, *italic*, lists, links, headings..."
            ></textarea>
          </div>
          <div>
            <label class="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Preview</label>
            <div
              class="min-h-[22rem] max-h-[26rem] overflow-y-auto px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 text-sm text-gray-900 dark:text-gray-100 prose prose-sm dark:prose-invert max-w-none"
              v-html="descriptionModalPreviewHtml"
            ></div>
          </div>
        </div>
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 text-sm" @click="closeDescriptionModal">Cancel</button>
          <button type="button" class="px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold" @click="saveDescriptionModal">Save description</button>
        </div>
      </div>
    </div>

    <!-- Transfer subscription modal -->
    <div
      v-if="transferSubModal.open"
      class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      @click.self="closeTransferSubscriptionModal"
    >
      <div
        ref="transferSubDialogRef"
        role="dialog"
        aria-modal="true"
        aria-label="Transfer subscription"
        tabindex="-1"
        class="w-full max-w-md rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5"
      >
        <template v-if="transferSubModal.step === 0">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-1">Transfer subscription</h3>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Move all subscription rows from <span class="font-medium text-gray-900 dark:text-white">{{ transferSubModal.sourceUser?.email }}</span>
            to another account. The destination must exist and must not already have an active or trialing subscription.
          </p>
          <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1" for="transfer-sub-target-email">Destination email</label>
          <input
            id="transfer-sub-target-email"
            v-model="transferSubModal.targetEmail"
            type="email"
            autocomplete="off"
            class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
            placeholder="user@example.com"
          />
          <p v-if="transferSubModal.error" class="text-sm text-red-600 dark:text-red-400 mt-2">{{ transferSubModal.error }}</p>
          <div class="flex justify-end gap-2 mt-5">
            <button type="button" class="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 text-sm" @click="closeTransferSubscriptionModal">Cancel</button>
            <button
              type="button"
              class="px-3 py-2 rounded bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold disabled:opacity-50"
              :disabled="!transferSubModal.targetEmail.trim()"
              @click="goTransferSubscriptionConfirm"
            >
              Continue
            </button>
          </div>
        </template>
        <template v-else-if="transferSubModal.step === 1">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Confirm transfer</h3>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Transfer subscription from
            <span class="font-medium text-gray-900 dark:text-white">{{ transferSubModal.sourceUser?.email }}</span>
            to
            <span class="font-medium text-gray-900 dark:text-white">{{ transferSubModal.targetEmail.trim() }}</span>?
            This reassigns every subscription row to the destination account.
          </p>
          <p v-if="transferSubModal.error" class="text-sm text-red-600 dark:text-red-400 mb-3">{{ transferSubModal.error }}</p>
          <div class="flex justify-end gap-2">
            <button type="button" class="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 text-sm" @click="transferSubModal.step = 0">Back</button>
            <button
              type="button"
              class="px-3 py-2 rounded bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold disabled:opacity-50"
              :disabled="transferSubModal.submitting"
              @click="executeTransferSubscription"
            >
              {{ transferSubModal.submitting ? 'Transferring…' : 'Confirm transfer' }}
            </button>
          </div>
        </template>
      </div>
    </div>

    <!-- Swap modal -->
    <div v-if="swapModal.open" class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" @click.self="swapModal.open = false">
      <div
        ref="swapDialogRef"
        role="dialog"
        aria-modal="true"
        aria-label="Swap video"
        tabindex="-1"
        class="w-full max-w-2xl rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5 max-h-[90vh] flex flex-col"
      >
        <!-- Step 0: pick a draft -->
        <template v-if="swapModal.step === 0">
          <div class="flex items-center justify-between mb-3 flex-shrink-0">
            <div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Swap out «{{ swapModal.sourceVideo?.title }}»</h3>
              <p class="text-sm text-gray-600 dark:text-gray-400 mt-0.5">Select a draft video to replace it. The draft will be published and inherit all settings.</p>
            </div>
            <button class="text-sm text-gray-600 dark:text-gray-300 hover:underline ml-4 flex-shrink-0" @click="swapModal.open = false">Close</button>
          </div>
          <div class="overflow-y-auto space-y-2 flex-1">
            <div v-if="!draftVideos.length" class="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">No draft videos available.</div>
            <button
              v-for="draft in draftVideos"
              :key="draft.id"
              class="w-full text-left p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-purple-500 dark:hover:border-purple-500 transition-colors flex items-center gap-3"
              @click="selectSwapTarget(draft)"
            >
              <div class="w-24 aspect-video rounded overflow-hidden bg-gray-200 dark:bg-gray-800 flex-shrink-0">
                <img v-if="draft.thumbnail_url" :src="sizeUrl(draft.thumbnail_url, 'small')" :alt="draft.title" class="w-full h-full object-cover" />
              </div>
              <div class="min-w-0">
                <p class="font-medium text-gray-900 dark:text-white line-clamp-1">{{ draft.title }}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{{ formatSeconds(getActualDuration(draft)) }} · uploaded {{ formatDate(draft.upload_date) }}</p>
              </div>
            </button>
          </div>
        </template>

        <!-- Step 1: confirm -->
        <template v-else-if="swapModal.step === 1">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-3">Confirm swap</h3>
          <div class="grid grid-cols-2 gap-4 mb-4">
            <div class="rounded-lg border border-red-200 dark:border-red-900 p-3">
              <p class="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide mb-2">Retiring</p>
              <div class="aspect-video rounded overflow-hidden bg-gray-200 dark:bg-gray-800 mb-2">
                <img v-if="swapModal.sourceVideo?.thumbnail_url" :src="sizeUrl(swapModal.sourceVideo.thumbnail_url, 'medium')" class="w-full h-full object-cover" alt="" />
              </div>
              <p class="font-medium text-gray-900 dark:text-white text-sm line-clamp-2">{{ swapModal.sourceVideo?.title }}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Will become «OLD - {{ swapModal.sourceVideo?.title }}» (draft)</p>
            </div>
            <div class="rounded-lg border border-green-200 dark:border-green-900 p-3">
              <p class="text-xs font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide mb-2">Publishing</p>
              <div class="aspect-video rounded overflow-hidden bg-gray-200 dark:bg-gray-800 mb-2">
                <img v-if="swapTargetVideo?.thumbnail_url" :src="sizeUrl(swapTargetVideo.thumbnail_url, 'medium')" class="w-full h-full object-cover" alt="" />
              </div>
              <p class="font-medium text-gray-900 dark:text-white text-sm line-clamp-2">{{ swapTargetVideo?.title }}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Will publish at /watch/{{ swapModal.sourceVideo?.slug ?? swapModal.sourceVideo?.id }}</p>
            </div>
          </div>
          <p class="text-sm text-amber-600 dark:text-amber-400 mb-4">⚠ This cannot be undone. Title, slug, thumbnail, dates, and preview lock transfer to the new video.</p>
          <div class="flex justify-end gap-2">
            <button class="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 text-sm" @click="swapModal.step = 0">Back</button>
            <button class="px-3 py-2 rounded bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold" @click="executeSwap">Confirm Swap</button>
          </div>
        </template>

        <!-- Step 2: in progress -->
        <template v-else>
          <div class="flex flex-col items-center justify-center py-12 gap-3">
            <div class="w-8 h-8 border-2 border-gray-300 border-t-purple-600 rounded-full animate-spin"></div>
            <p class="text-sm text-gray-600 dark:text-gray-400">Swapping videos…</p>
          </div>
        </template>
      </div>
    </div>

    <div v-if="pickerOpen" class="fixed inset-0 z-40 bg-black/50 flex items-end sm:items-center justify-center p-4" @click.self="closePicker">
      <div class="w-full max-w-3xl max-h-[80vh] overflow-y-auto rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-bold text-gray-900 dark:text-white">Choose replacement for featured slot {{ activeSlotIndex + 1 }}</h3>
          <button class="text-sm text-gray-600 dark:text-gray-300 hover:underline" @click="closePicker">Close</button>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            v-for="video in chronologicallySortedUploads"
            :key="`picker-${video.id}`"
            class="text-left p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-500"
            @click="swapFeatured(video)"
          >
            <div class="aspect-video rounded-md overflow-hidden bg-gray-200 dark:bg-gray-800 mb-2">
              <img v-if="video.thumbnail_url" :src="video.thumbnail_url" :alt="video.title" class="w-full h-full object-cover" />
            </div>
            <p class="font-medium text-gray-900 dark:text-white line-clamp-2">{{ video.title }}</p>
            <p class="text-xs text-gray-600 dark:text-gray-400 mt-1">{{ formatDate(video.upload_date) }}</p>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { resolvePlaylistDuration } from '~/composables/useHlsDuration'
import { sizeUrl } from '~/composables/useThumbnail'
import { useAdminNewsletterPolling } from '~/composables/useAdminNewsletterPolling'
import { buildHomepageRenderModel } from '~/composables/useHomepageLayout'
import type { HomepageLayoutBlock, HomepagePlacementResponse, HomepageRenderLeafBlock, HomepageRenderSplitBlock } from '~/composables/useHomepageLayout'
import { renderMarkdownToHtml } from '~/utils/markdown'
import { Upload as TusUpload } from 'tus-js-client'

// ── Route guard ───────────────────────────────────────────────────────────────
// This single line is the only meaningful addition to this file.
// The middleware checks auth + role before this component ever mounts.
definePageMeta({ middleware: 'admin' })

// ── Everything below is unchanged from the previous version ──────────────────

interface Video {
  id: string
  title: string
  description: string
  thumbnail_url: string
  upload_date: string
  full_duration: number
  preview_duration: number
  publish_status: 'draft' | 'published' | 'archived' | null
  published_at?: string | null
  scheduled_publish_at?: string | null
  notified_at?: string | null
  r2_exists: boolean | null
  slug?: string | null
  legacy_slug?: string | null
  category_id?: string | null
  total_views?: number
  livestream_provider?: string | null
  livestream_status?: string | null
  livestream_moq_endpoint?: string | null
  livestream_moq_broadcast?: string | null
  livestream_recording_video_id?: string | null
  ingest_status?: 'uploaded' | 'queued' | 'transcoding' | 'packaging' | 'uploading' | 'completed' | 'failed' | null
  media_convert_usage?: {
    input_duration_seconds?: number
    normalized_minutes_est?: number
    estimated_cost_usd?: number
  } | null
}

interface Category {
  id: string
  name: string
  slug: string
  sort_order: number
  direction: 'asc' | 'desc'
  homepage_layout_variant?: 'three_by_one' | 'side_mini'
  video_count?: number
}

/** Row shape from GET /api/admin/users */
interface AdminUserRow {
  id: string
  email: string
  role: string
  subscription_status?: string | null
  created_at?: string
  plan_type?: string | null
  current_period_end?: string | null
  /** Optimistic / pending select value; cleared after successful reload */
  uiRole?: string
  uiSubscription?: string
}

type BlockType = 'featured_row' | 'category' | 'top_video' | 'split_horizontal' | 'split_vertical'
type LeafBlockType = 'featured_row' | 'category' | 'top_video'
type LayoutBlock = HomepageLayoutBlock

type AnalyticsRange = '7d' | '30d' | '90d' | '180d' | '365d'
type AnalyticsGranularity = 'day' | 'week' | 'month'
type AnalyticsDataset = 'all' | 'overview' | 'views' | 'retention' | 'sources' | 'subscriptions' | 'cashflow'

interface AnalyticsSeriesPoint {
  bucket: string
  uniqueSessions?: number
  newSubscriptions?: number
  churnedSubscriptions?: number
  expiringSubscriptions?: number
  estimatedNewRevenueEur?: number
  estimatedNetNewEur?: number
}

interface AnalyticsResponse {
  meta?: {
    range?: AnalyticsRange
    granularity?: AnalyticsGranularity
    generatedAt?: string
    startAt?: string
    endAt?: string
  }
  kpis?: {
    totalUniqueViews?: number
    averageRetentionPercent?: number
    activeSubscribers?: number
    churnRatePercent?: number
    estimatedActiveMrrEur?: number
  }
  definitions?: Record<string, string>
  views?: {
    totalUniqueSessions?: number
    series?: AnalyticsSeriesPoint[]
  }
  trafficSources?: Array<{ source: string, unique_sessions?: number, hits?: number }>
  videoStats?: Array<{
    videoId: string
    title: string
    slug: string | null
    publishedAt: string | null
    viewCount: number
    averageRetentionPercent: number | null
  }>
  subscriptions?: Array<{ status: string, count: number }>
  subscriptionOverview?: {
    statusBreakdown?: Array<{ status: string, count: number }>
    trends?: AnalyticsSeriesPoint[]
  }
  cashflow?: {
    currency?: string
    activeMrrEstimateEur?: number
    trend?: AnalyticsSeriesPoint[]
  }
  // Legacy fallbacks kept while API transitions.
  totalViews?: number
  subscriptionsLegacy?: Array<{ status: string, count: number }>
}

const config = useRuntimeConfig()
const { authHeader, isAdmin, user } = useAuth()
const router = useRouter()
const route = useRoute()
const loading = ref(true)
const videosLoading = ref(false)
const uploads = ref<Video[]>([])
const pickerOpen = ref(false)
const activeSlotIndex = ref(0)
const featuredSlots = ref<(Video | null)[]>([])
const draggingIndex = ref<number | null>(null)
const saving = ref(false)
const saveMessage = ref('')
const saveMessageClass = ref('')
const previewLockByVideoId = ref<Record<string, number>>({})
const actualDurationByVideoId = ref<Record<string, number>>({})
const statusUpdating = ref<Record<string, boolean>>({})
const scheduleTextDraft = ref<Record<string, string>>({})
const publishedTextDraft = ref<Record<string, string>>({})
const uploadDateEditDraft = ref<Record<string, string>>({})
const notifying = ref<Record<string, boolean>>({})
const trashing = ref<Record<string, boolean>>({})
const uploadingFor = ref<string | null>(null)
const mediaConvertConfig = ref({
  enabled: false,
  configured: false,
  tusConfigured: false,
})
const mediaUpload = ref<{
  file: File | null
  title: string
  description: string
  progress: number
  status: 'uploaded' | 'queued' | 'transcoding' | 'packaging' | 'uploading' | 'completed' | 'failed'
  busy: boolean
  message: string
  error: boolean
}>({
  file: null,
  title: '',
  description: '',
  progress: 0,
  status: 'uploaded',
  busy: false,
  message: '',
  error: false,
})
const activeAdminTab = ref<'videos' | 'categories' | 'homepage' | 'pills' | 'notifications' | 'newsletter' | 'users' | 'analytics' | 'system'>('videos')
const baseAdminTabs = [
  { id: 'videos' as const, label: 'Videos' },
  { id: 'categories' as const, label: 'Categories' },
  { id: 'homepage' as const, label: 'Homepage' },
  { id: 'pills' as const, label: 'Pills' },
  { id: 'notifications' as const, label: 'Notifications' },
  { id: 'newsletter' as const, label: 'Newsletter' },
  { id: 'users' as const, label: 'Users & roles' },
  { id: 'analytics' as const, label: 'Analytics' },
  { id: 'system' as const, label: 'System' },
]
const adminTabs = computed(() =>
  baseAdminTabs.filter(tab => tab.id !== 'pills' || isAdmin.value)
)
const editingTitle = ref<{ id: string; value: string } | null>(null)
const titleInputEl = ref<HTMLInputElement | null>(null)
const editingSlug  = ref<{ id: string; value: string } | null>(null)
const slugInputEl  = ref<HTMLInputElement | null>(null)
const editingLegacySlug = ref<{ id: string; value: string } | null>(null)
const legacySlugInputEl = ref<HTMLInputElement | null>(null)
const scheduleModal = ref<{
  open: boolean
  videoId: string | null
  uploadDate: string
  scheduleDate: string
  publishedDate: string
}>({
  open: false,
  videoId: null,
  uploadDate: '',
  scheduleDate: '',
  publishedDate: '',
})
const descriptionModal = ref<{
  open: boolean
  videoId: string | null
  title: string
  value: string
}>({
  open: false,
  videoId: null,
  title: '',
  value: '',
})
const descriptionInputEl = ref<HTMLTextAreaElement | null>(null)
const swapModal = ref<{
  open: boolean
  step: number  // 0=pick, 1=confirm, 2=loading
  sourceVideo: Video | null
  targetId: string | null
}>({ open: false, step: 0, sourceVideo: null, targetId: null })
const transferSubModal = ref<{
  open: boolean
  step: number
  sourceUser: AdminUserRow | null
  targetEmail: string
  error: string | null
  submitting: boolean
}>({
  open: false,
  step: 0,
  sourceUser: null,
  targetEmail: '',
  error: null,
  submitting: false,
})
const livestreamModal = ref({
  open: false,
  saving: false,
  error: '',
  form: {
    title: '',
    description: '',
    slug: '',
    status: 'draft',
    publishStatus: 'draft',
    moqEndpoint: '',
    moqBroadcast: '',
  },
})
const componentTypes: BlockType[] = ['top_video', 'featured_row', 'category', 'split_horizontal', 'split_vertical']
const leafComponentTypes: LeafBlockType[] = ['top_video', 'featured_row', 'category']
const blockTypeOptions = (currentType: unknown): string[] => {
  if (typeof currentType !== 'string' || !currentType.trim()) return componentTypes
  return componentTypes.includes(currentType as BlockType) ? componentTypes : [currentType, ...componentTypes]
}
const leafBlockTypeOptions = (currentType: unknown): string[] => {
  if (typeof currentType !== 'string' || !currentType.trim()) return leafComponentTypes
  return leafComponentTypes.includes(currentType as LeafBlockType) ? leafComponentTypes : [currentType, ...leafComponentTypes]
}
const layoutBlocks = ref<LayoutBlock[]>([])
const homepageBaseline = ref<string>('')

const newsletterListId = ref('')
const newsletterSenderEmail = ref('')
const newsletterSenderName = ref('')
/** Poll interval for campaign list refresh (ms); from API, default 10 min */
const newsletterPollIntervalMs = ref(600_000)
const newsletterSubject = ref('')
const newsletterHtml = ref('')
const newsletterTemplateId = ref('')
const newsletterSaving = ref(false)
const newsletterSending = ref(false)
const newsletterMessage = ref('')
const newsletterMessageClass = ref('')
const categories = ref<Category[]>([])
const categoryForm = ref({
  name: '',
  slug: '',
  sortOrder: 0,
  direction: 'desc' as 'asc' | 'desc',
  homepageLayoutVariant: 'three_by_one' as 'three_by_one' | 'side_mini',
})
const newsletterSyncing = ref(false)
const newsletterTemplates = ref<any[]>([])
const newsletterCampaigns = ref<any[]>([])
const newsletterTemplateForm = ref({ name: '', subject: '', htmlBody: '' })
const newsletterEditingTemplateId = ref<string | null>(null)
const newsletterTemplateSaving = ref(false)
type PaymentProvider = 'stripe' | 'gocardless'
type PlanType = 'monthly' | 'yearly' | 'club'
interface PaymentPriceRow { monthly: string; yearly: string; club: string }
interface PromoCampaign {
  id: string
  name: string
  description?: string | null
  is_active: number
  code_count?: number
  total_redemptions?: number
}
interface PromoCodeRow {
  id: string
  campaign_id: string
  campaign_name?: string | null
  code: string
  reward_type: string
  max_uses: number
  used_count: number
  is_active: number
  allowed_plan_types: string
  stripe_coupon_id?: string | null
  gocardless_discount_percent?: number | null
  gocardlessPlanCode?: string | null
  gocardless_plan_code?: string | null
}
interface IsicCampaignRow {
  id: string
  name: string
  description?: string | null
  is_active: number
  free_slots_limit: number
  discount_percent: number
  renewal_months: number
  popup_behavior: string
  country_scope: string
}
type PromoRewardType = 'free_month' | 'free_year' | 'discount_percent'
type IsicPopupBehavior = 'default' | 'highlight_campaign' | 'hide_standard' | 'isic_first'

const paymentSettings = ref<{
  enabledProviders: PaymentProvider[]
  providerOrder: [PaymentProvider, PaymentProvider]
  allowedPlans: PlanType[]
  basePrices: PaymentPriceRow
  providerPrices: { stripe: PaymentPriceRow; gocardless: PaymentPriceRow }
  stripePriceIds: PaymentPriceRow
}>({
  enabledProviders: ['stripe'],
  providerOrder: ['stripe', 'gocardless'],
  allowedPlans: ['monthly', 'yearly', 'club'],
  basePrices: { monthly: '', yearly: '', club: '' },
  providerPrices: {
    stripe: { monthly: '', yearly: '', club: '' },
    gocardless: { monthly: '', yearly: '', club: '' },
  },
  stripePriceIds: { monthly: '', yearly: '', club: '' },
})
const paymentSettingsSaving = ref(false)
const paymentSettingsMessage = ref('')
const paymentSettingsMessageClass = ref('')
const systemFeatures = ref({
  promotionsEnabled: true,
  isicEnabled: false,
  freePodcastPreviewEnabled: true,
  videoUploaderEnabled: true,
})
const systemFeaturesSaving = ref(false)
const systemFeaturesMessage = ref('')
const systemFeaturesMessageClass = ref('')
const mediaConvertSystem = ref({
  enabled: false,
  awsRegion: '',
  awsAccessKeyId: '',
  awsSecretAccessKey: '',
  hasAwsSecret: false,
  awsSessionToken: '',
  hasAwsSession: false,
  endpoint: '',
  roleArn: '',
  inputBucket: '',
  outputBucket: '',
  inputPrefix: 'mediaconvert-input',
  outputPrefix: 'mediaconvert-output',
  tusEndpoint: '',
  tusAuthToken: '',
  hasTusAuth: false,
})
const mediaConvertSystemSaving = ref(false)
const mediaConvertSystemMessage = ref('')
const mediaConvertSystemMessageClass = ref('')
const replicationStatus = ref<{
  mode: string
  batchSize: number
  targetConfigured: boolean
  targetIngestPathOk?: boolean
  targetResolvedPath?: string
  targetWarning?: string | null
  targetProbe?: { ok: boolean; error?: string } | null
  streams?: { stream_name: string; cursor_value: string; updated_at: string }[]
} | null>(null)
const replicationPushing = ref(false)
const replicationResetting = ref(false)
const replicationMessage = ref('')
const replicationMessageClass = ref('')
const replicationCanPush = computed(() => {
  const status = replicationStatus.value
  if (!status?.targetConfigured) return false
  if (status.targetWarning) return false
  if (status.targetProbe && !status.targetProbe.ok) return false
  return true
})
const promotionsLoading = ref(false)
const promotionsSaving = ref(false)
const promoCampaigns = ref<PromoCampaign[]>([])
const promoCodes = ref<PromoCodeRow[]>([])
const promoCampaignForm = ref({
  name: '',
  description: '',
  isActive: true,
})
const promoCodeForm = ref({
  campaignId: '',
  code: '',
  quantity: 1,
  rewardType: 'free_month',
  maxUses: 1,
  allowedPlanTypes: ['monthly', 'yearly', 'club'] as string[],
  stripeCouponId: '',
  gocardlessDiscountPercent: '',
  gocardlessPlanCode: '',
  expiresAt: '',
})
const isicLoading = ref(false)
const isicSaving = ref(false)
const isicCampaigns = ref<IsicCampaignRow[]>([])
const isicApiConfig = ref({
  enabled: false,
  baseUrl: '',
  apiKey: '',
  hasApiKey: false,
})
const isicCampaignForm = ref({
  name: '',
  description: '',
  freeSlotsLimit: 5000,
  discountPercent: 0,
  renewalMonths: 12,
  popupBehavior: 'highlight_campaign',
  countryScope: 'CZ,SK',
  isActive: true,
})
const promotionsMessage = ref('')
const promotionsMessageClass = ref('')
const isicMessage = ref('')
const isicMessageClass = ref('')

const siteBranding = ref({
  site_name: '',
  site_name_short: '',
  site_description: '',
  site_logo_url: '',
  site_favicon_url: '',
  podcast_title: '',
  podcast_description: '',
})
const siteBrandingSaving = ref(false)
const siteBrandingMessage = ref('')
const siteBrandingMessageClass = ref('')
const rssPodcastWebhookUrl = ref('')
const rssPodcastWebhookSecretInput = ref('')
const rssPodcastSecretConfigured = ref(false)
const rssPodcastWebhookSaving = ref(false)
const rssPodcastNotifySending = ref(false)
const rssPodcastMessage = ref('')
const rssPodcastMessageClass = ref('')

const paymentPrimaryProvider = computed<PaymentProvider>({
  get() {
    return paymentSettings.value.providerOrder[0] === 'gocardless' ? 'gocardless' : 'stripe'
  },
  set(next) {
    paymentSettings.value.providerOrder = next === 'gocardless'
      ? ['gocardless', 'stripe']
      : ['stripe', 'gocardless']
  },
})

let usersLoadRequestId = 0
const users = ref<AdminUserRow[]>([])
const usersLoading = ref(false)
const usersPage = ref(1)
const usersPageSize = ref(25)
const usersTotal = ref(0)
const usersTotalPages = ref(1)
const usersSearchInput = ref('')
const usersSearchDebounced = ref('')
const usersRoleFilter = ref('all')
const usersSubscriptionFilter = ref('all')
let usersSearchDebounceTimer: ReturnType<typeof setTimeout> | null = null
const usersImportCsv = ref('')
const usersImportMailingListId = ref('')
const usersImporting = ref(false)
const usersImportResult = ref<{ imported: number; existing: number; totalEmails: number; mailingListId: string } | null>(null)

const ROLE_ORDER = ['viewer', 'moderator', 'analyst', 'editor', 'admin', 'super_admin'] as const
function roleRank(role: string): number {
  const i = ROLE_ORDER.indexOf(role as (typeof ROLE_ORDER)[number])
  return i === -1 ? 0 : i
}
function isRoleDemotion(from: string, to: string): boolean {
  return roleRank(to) < roleRank(from)
}
function isSensitiveRoleChange(from: string, to: string): boolean {
  if (from === to) return false
  if (isRoleDemotion(from, to)) return true
  if (to === 'admin' || to === 'super_admin') return true
  if (from === 'admin' || from === 'super_admin') return true
  return false
}
type PillValueMode = 'number' | 'percentage' | 'agree_disagree' | 'graph_embed'
type AdminPillRow = {
  id: string
  label: string
  value: number
  value_secondary?: number | null
  value_mode?: PillValueMode
  graph_embed_url?: string | null
  graph_payload_json?: string | null
  color: string
  image_url?: string | null
  sort_order: number
}
const adminPills = ref<AdminPillRow[]>([])
const newPill = ref({
  label: '',
  value: 0,
  valueSecondary: '',
  valueMode: 'number' as PillValueMode,
  graphEmbedUrl: '',
  graphPayloadJson: '',
  color: '#2563eb',
  imageUrl: '',
})
const pillsApiKey = ref('')
const pillsApiKeyMeta = ref<{ hasKey: boolean; managedByEnv: boolean; maskedKey: string }>({ hasKey: false, managedByEnv: false, maskedKey: '' })
const analyticsRange = ref<AnalyticsRange>('30d')
const analyticsGranularity = ref<AnalyticsGranularity>('day')
const analyticsLoading = ref(false)
const analyticsError = ref('')
const analytics = ref<AnalyticsResponse>({
  views: { totalUniqueSessions: 0, series: [] },
  trafficSources: [],
  videoStats: [],
  subscriptions: [],
  subscriptionOverview: { statusBreakdown: [], trends: [] },
  cashflow: { currency: 'EUR', activeMrrEstimateEur: 0, trend: [] },
  subscriptionsLegacy: [],
})

const analyticsExporting = ref<AnalyticsDataset | null>(null)
const analyticsSettingsSaving = ref(false)
const analyticsSettingsInitialized = ref(false)
const analyticsViewCounting = ref({
  minSegmentsPerSession: 1,
  minWatchSeconds: 15,
})

interface PushCampaignFunnel {
  campaignId: string
  videoTitle: string
  sent: number
  clicks: number
  clickRatePercent: number
  medianClickLatencySeconds: number | null
  watchSessions: number
  watchRatePercent: number
  completionRatePercent: number
  avgSessionDepth: number
}

const pushCampaignFunnel = ref<PushCampaignFunnel | null>(null)
const pushCampaignFunnelError = ref<string | null>(null)

const analyticsStatusRows = computed(() => {
  if (Array.isArray(analytics.value.subscriptionOverview?.statusBreakdown)) return analytics.value.subscriptionOverview?.statusBreakdown ?? []
  if (Array.isArray(analytics.value.subscriptionsLegacy)) return analytics.value.subscriptionsLegacy
  if (Array.isArray(analytics.value.subscriptions)) return analytics.value.subscriptions
  return []
})

function formatMetricValue(key: string, value: number | undefined) {
  const numeric = Number(value ?? 0)
  if (key === 'estimatedActiveMrrEur') return `€${numeric.toFixed(2)}`
  if (key.toLowerCase().includes('percent') || key === 'churnRatePercent') return `${numeric.toFixed(2)}%`
  return String(Math.round(numeric))
}

const analyticsKpiCards = computed(() => {
  const kpis = analytics.value.kpis ?? {}
  const defs = analytics.value.definitions ?? {}
  return [
    { key: 'totalUniqueViews', label: 'Unique views', value: formatMetricValue('totalUniqueViews', kpis.totalUniqueViews), help: defs.totalUniqueViews || 'Distinct sessions in selected range.' },
    { key: 'averageRetentionPercent', label: 'Avg retention', value: formatMetricValue('averageRetentionPercent', kpis.averageRetentionPercent), help: defs.averageRetentionPercent || 'Average max watch-through across qualified sessions.' },
    { key: 'activeSubscribers', label: 'Active subscribers', value: formatMetricValue('activeSubscribers', kpis.activeSubscribers), help: defs.activeSubscribers || 'Latest active/trialing subscription rows.' },
    { key: 'churnRatePercent', label: 'Churn rate', value: formatMetricValue('churnRatePercent', kpis.churnRatePercent), help: defs.churnRatePercent || 'Churned divided by new subscriptions.' },
    { key: 'estimatedActiveMrrEur', label: 'Estimated MRR', value: formatMetricValue('estimatedActiveMrrEur', kpis.estimatedActiveMrrEur), help: defs.estimatedActiveMrrEur || 'Estimated monthly recurring revenue.' },
  ]
})

function normalizeChartRows(values: number[]) {
  const max = values.length ? Math.max(...values) : 0
  return { max: max > 0 ? max : 1 }
}

const analyticsViewsSeriesChartRows = computed(() => {
  const rows = (analytics.value.views?.series ?? []).map((row) => ({ bucket: String(row.bucket), value: Number(row.uniqueSessions || 0) }))
  const norm = normalizeChartRows(rows.map((row) => row.value))
  return rows.map((row) => ({ ...row, percent: Math.round((row.value / norm.max) * 100) }))
})

const analyticsTrafficChartRows = computed(() => {
  const rows = (analytics.value.trafficSources ?? []).map((row) => ({
    source: row.source,
    value: Number(row.unique_sessions ?? row.hits ?? 0),
  }))
  const norm = normalizeChartRows(rows.map((row) => row.value))
  return rows.map((row) => ({ ...row, percent: Math.round((row.value / norm.max) * 100) }))
})

const analyticsVideoStatsRows = computed(() =>
  (analytics.value.videoStats ?? []).map((row) => ({
    videoId: row.videoId,
    title: row.title,
    slug: row.slug,
    viewCount: Number(row.viewCount || 0),
    averageRetentionPercent: row.averageRetentionPercent,
  })),
)

function formatVideoRetention(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  return `${Number(value).toFixed(1)}%`
}

function videoWatchHref(row: { videoId: string, slug: string | null }) {
  const slugOrId = row.slug?.trim() || row.videoId
  return `/watch/${encodeURIComponent(slugOrId)}`
}

const analyticsSubscriptionTrendRows = computed(() =>
  (analytics.value.subscriptionOverview?.trends ?? []).map((row) => ({
    bucket: String(row.bucket),
    newSubscriptions: Number(row.newSubscriptions || 0),
    churnedSubscriptions: Number(row.churnedSubscriptions || 0),
    expiringSubscriptions: Number(row.expiringSubscriptions || 0),
  })),
)

const analyticsCashflowRows = computed(() =>
  (analytics.value.cashflow?.trend ?? []).map((row) => ({
    bucket: String(row.bucket),
    estimatedNewRevenueEur: Number(row.estimatedNewRevenueEur || 0),
    estimatedNetNewEur: Number(row.estimatedNetNewEur || 0),
  })),
)

watch([analyticsRange, analyticsGranularity], () => {
  if (activeAdminTab.value === 'analytics') {
    void loadAnalytics()
  }
})
/** Stable per send attempt until success — retries reuse the same key for server idempotency. */
const newsletterSendDedupeKey = ref<string | null>(null)

/** Sandboxed document for preview — avoids v-html XSS in the admin app. */
const newsletterPreviewSrcdoc = computed(() => {
  const bodyHtml = newsletterHtml.value
  if (!bodyHtml.trim()) return ''
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>
    body{font-family:system-ui,sans-serif;margin:0;padding:12px;color:#111;background:#fff}
    @media (prefers-color-scheme: dark){ body{color:#e5e5e5;background:#0a0a0a} }
  </style></head><body>${bodyHtml}</body></html>`
})

watch(
  [newsletterTemplateId, newsletterTemplates],
  () => {
    const id = newsletterTemplateId.value
    if (!id) return
    const t = newsletterTemplates.value.find((x: { id: string }) => x.id === id)
    if (t) {
      newsletterSubject.value = String(t.subject || '')
      newsletterHtml.value = String(t.html_body || '')
    }
  },
  { deep: true },
)

const chronologicallySortedUploads = computed(() =>
  [...uploads.value].sort((a, b) => new Date(b.upload_date).getTime() - new Date(a.upload_date).getTime())
)

const notifiedVideoIds = computed(() => {
  const ids = new Set<string>()
  for (const video of uploads.value) {
    if (video.notified_at) ids.add(video.id)
  }
  return ids
})

const pendingNotificationVideos = computed(() =>
  chronologicallySortedUploads.value.filter((video) => video.publish_status === 'published' && !notifiedVideoIds.value.has(video.id))
)

function isVideoNotified(video: Video) {
  return notifiedVideoIds.value.has(video.id)
}

const draftVideos      = computed(() => chronologicallySortedUploads.value.filter(v =>
  v.publish_status === 'draft' && v.r2_exists !== false && !v.livestream_provider
))
const swapTargetVideo  = computed(() => uploads.value.find(v => v.id === swapModal.value.targetId) ?? null)

const featuredVideos = computed(() =>
  featuredSlots.value.length ? featuredSlots.value : [...chronologicallySortedUploads.value.slice(0, 4)]
)

const previewLeafBlocks = computed(() =>
  homepagePreviewModel.value.blockItems.filter((block): block is HomepageRenderLeafBlock =>
    block.type === 'featured_row' || block.type === 'category' || block.type === 'top_video',
  ),
)

const previewSplitBlocks = computed(() =>
  homepagePreviewModel.value.blockItems.filter((block): block is HomepageRenderSplitBlock =>
    block.type === 'split_horizontal' || block.type === 'split_vertical',
  ),
)

const homepagePlacement = ref<HomepagePlacementResponse | null>(null)
const mergedHomepagePlacement = computed(() => {
  const base = homepagePlacement.value || { featured: [], recentGrid: [], categoryBlocks: [] }
  const featuredIds = featuredSlots.value.map((v) => v?.id).filter((v): v is string => Boolean(v))
  return {
    ...base,
    featured: featuredIds.map((id) => ({ id })),
    categoryBlocks: categories.value.map((cat) => {
      const existing = base.categoryBlocks?.find((b) => b.category.id === cat.id)
      if (existing) {
        return {
          ...existing,
          category: {
            ...cat,
            homepage_layout_variant: cat.homepage_layout_variant || 'three_by_one',
          },
        }
      }
      return {
        category: {
          ...cat,
          homepage_layout_variant: cat.homepage_layout_variant || 'three_by_one',
        },
        visible: [],
        overflow: [],
      }
    }),
  }
})
const homepagePreviewModel = computed(() =>
  buildHomepageRenderModel({
    videos: chronologicallySortedUploads.value,
    layoutBlocks: layoutBlocks.value,
    placement: mergedHomepagePlacement.value,
  }),
)
const homepageDirty = computed(() => serializeHomepageState() !== homepageBaseline.value)

const openPicker  = (slotIndex: number) => { activeSlotIndex.value = slotIndex; pickerOpen.value = true }
const closePicker = () => { pickerOpen.value = false }

const swapFeatured = (video: Video) => {
  const next = [...featuredVideos.value]
  next[activeSlotIndex.value] = video
  while (next.length < 4) next.push(null)
  featuredSlots.value = next
  closePicker()
}

// SQLite CURRENT_TIMESTAMP returns "YYYY-MM-DD HH:MM:SS" which Safari cannot
// parse reliably — normalize to ISO 8601 before constructing the Date.
const formatDate = (raw: string) => {
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z'
  return new Date(normalized).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** European local wall time for admin schedule / publish inputs (24h). */
const formatEuropeanDateTimeFromAny = (raw?: string | null) => {
  if (!raw) return ''
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z'
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return ''
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const yyyy = String(date.getFullYear())
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${dd}.${mm}.${yyyy} ${hh}:${min}`
}

/** Parse `DD.MM.YYYY HH:mm` or `D.M.YYYY H:mm` in local timezone → ISO for API. */
const parseEuropeanDateTimeToIso = (raw: string): string | null => {
  const m = raw.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const d = Number(m[1])
  const mo = Number(m[2])
  const y = Number(m[3])
  const h = Number(m[4])
  const mi = Number(m[5])
  if (!Number.isFinite(d) || !Number.isFinite(mo) || !Number.isFinite(y) || !Number.isFinite(h) || !Number.isFinite(mi)) return null
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h < 0 || h > 23 || mi < 0 || mi > 59) return null
  const local = new Date(y, mo - 1, d, h, mi, 0, 0)
  if (
    local.getFullYear() !== y ||
    local.getMonth() !== mo - 1 ||
    local.getDate() !== d ||
    local.getHours() !== h ||
    local.getMinutes() !== mi
  ) return null
  return local.toISOString()
}

const scheduleInputPlaceholder = 'DD.MM.YYYY HH:mm'
const categorySelectWidthCh = computed(() => {
  const maxAllowedWidthCh = 30
  const longestNameLength = categories.value.reduce((max, category) => Math.max(max, String(category.name || '').length), 0)
  return Math.min(maxAllowedWidthCh, Math.max(12, longestNameLength + 2))
})
const getVideoById = (videoId: string | null) => {
  if (!videoId) return null
  return uploads.value.find((video) => video.id === videoId) ?? null
}
const scheduleModalVideo = computed(() => getVideoById(scheduleModal.value.videoId))
const descriptionModalPreviewHtml = computed(() => {
  const html = renderMarkdownToHtml(descriptionModal.value.value)
  return html || '<p class="text-gray-500 dark:text-gray-400">No description preview.</p>'
})

const isScheduledDraft = (video: Video) =>
  video.publish_status === 'draft' && Boolean(video.scheduled_publish_at)

function statusBadgeLabel(video: Video) {
  if (isScheduledDraft(video)) return 'scheduled'
  return video.publish_status ?? 'draft'
}

const openScheduleModal = (video: Video) => {
  scheduleModal.value = {
    open: true,
    videoId: video.id,
    uploadDate: uploadDateEditDraft.value[video.id] ?? formatEuropeanDateTimeFromAny(video.upload_date),
    scheduleDate: scheduleTextDraft.value[video.id] ?? formatEuropeanDateTimeFromAny(video.scheduled_publish_at || null),
    publishedDate: publishedTextDraft.value[video.id] ?? formatEuropeanDateTimeFromAny(video.published_at || null),
  }
}

const closeScheduleModal = () => {
  scheduleModal.value.open = false
}

const setScheduleDraft = (videoId: string, value: string) => {
  scheduleTextDraft.value = { ...scheduleTextDraft.value, [videoId]: value }
}

const setPublishedDraft = (videoId: string, value: string) => {
  publishedTextDraft.value = { ...publishedTextDraft.value, [videoId]: value }
}

const setUploadDateDraft = (videoId: string, value: string) => {
  uploadDateEditDraft.value = { ...uploadDateEditDraft.value, [videoId]: value }
}

const clearScheduleTextDraft = (videoId: string) => {
  const next = { ...scheduleTextDraft.value }
  delete next[videoId]
  scheduleTextDraft.value = next
}

const clearPublishedTextDraft = (videoId: string) => {
  const next = { ...publishedTextDraft.value }
  delete next[videoId]
  publishedTextDraft.value = next
}

/** Promo code expiry still uses native datetime-local input. */
const parseOptionalLocalDateTimeToIso = (raw?: string | null) => {
  if (!raw) return null
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

const formatDateTime = (raw?: string | null) => {
  if (!raw) return '—'
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z'
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
const getActualDuration = (video: Video) => actualDurationByVideoId.value[video.id] ?? video.full_duration

const hydrateActualDurations = async () => {
  const durations = await Promise.all(uploads.value.map(async (video) => {
    try {
      const res  = await fetch(
        `${config.public.apiUrl}/api/video-access/${video.id}`,
        { headers: authHeader() }
      )
      if (!res.ok) return [video.id, video.full_duration] as const
      const data = await res.json()
      const resolved = await resolvePlaylistDuration(data?.video?.playlistUrl)
      return [video.id, resolved ?? video.full_duration] as const
    } catch {
      return [video.id, video.full_duration] as const
    }
  }))
  actualDurationByVideoId.value = Object.fromEntries(durations)
}

const defaultSplitChildren = (): Array<{ type: LeafBlockType, title: string, body: string, categoryId: string | null }> => ([
  { type: 'top_video', title: 'Top video', body: '', categoryId: null },
  { type: 'category', title: 'Category', body: '', categoryId: '' },
])
const addBlock = (type: BlockType) => {
  if (type === 'split_horizontal' || type === 'split_vertical') {
    layoutBlocks.value.push({
      id: crypto.randomUUID(),
      type,
      title: 'Split block',
      body: '',
      childBlocks: defaultSplitChildren().map((child) => ({ ...child })),
    } as LayoutBlock)
    return
  }
  layoutBlocks.value.push({
    id: crypto.randomUUID(),
    type,
    title: type === 'category' ? 'Category block' : 'New block',
    body: '',
    categoryId: type === 'category' ? '' : null,
  } as LayoutBlock)
}
const removeBlock = (id: string)      => { layoutBlocks.value = layoutBlocks.value.filter(b => b.id !== id) }

const onDragStart = (index: number) => { draggingIndex.value = index }
const onDrop = (targetIndex: number) => {
  if (draggingIndex.value === null || draggingIndex.value === targetIndex) return
  const reordered = [...layoutBlocks.value]
  const [moved]   = reordered.splice(draggingIndex.value, 1)
  if (!moved) return
  reordered.splice(targetIndex, 0, moved)
  layoutBlocks.value  = reordered
  draggingIndex.value = null
}

const getDefaultBlocks = (): LayoutBlock[] => ([])

const normalizeLoadedBlock = (raw: any): LayoutBlock | null => {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' ? raw.id : crypto.randomUUID()
  const rawType = typeof raw.type === 'string' ? raw.type.trim() : ''
  const type: BlockType = (rawType || 'top_video') as BlockType
  const title = typeof raw.title === 'string' ? raw.title : ''
  const body = typeof raw.body === 'string' ? raw.body : ''
  const categoryId = typeof raw.categoryId === 'string' ? raw.categoryId : ''
  const rightRailWithNextSideMini = raw.rightRailWithNextSideMini === true
  if (type === 'split_horizontal' || type === 'split_vertical') {
    const children = Array.isArray(raw.childBlocks) ? raw.childBlocks : []
    const normalizedChildren = children
      .filter((child: any) => child && typeof child === 'object')
      .map((child: any) => ({
        type: ((typeof child?.type === 'string' && child.type.trim()) ? child.type : 'top_video') as LeafBlockType,
        title: typeof child.title === 'string' ? child.title : '',
        body: typeof child.body === 'string' ? child.body : '',
        categoryId: typeof child.categoryId === 'string' ? child.categoryId : '',
      }))
      .slice(0, 2)
    while (normalizedChildren.length < 2) normalizedChildren.push({ type: 'top_video', title: '', body: '', categoryId: '' })
    return { id, type, title, body, childBlocks: normalizedChildren }
  }
  return {
    id,
    type,
    title,
    body,
    categoryId: type === 'category' ? categoryId : null,
    rightRailWithNextSideMini: type === 'category' ? rightRailWithNextSideMini : false,
  }
}
const sanitizeBlockForSave = (block: LayoutBlock) => {
  const payload: any = {
    id: block.id,
    type: block.type,
    title: block.title ?? '',
    body: block.body ?? '',
  }
  if (block.type === 'category') {
    payload.categoryId = typeof block.categoryId === 'string' ? block.categoryId : null
    payload.rightRailWithNextSideMini = block.rightRailWithNextSideMini === true
  }
  if ((block.type === 'split_horizontal' || block.type === 'split_vertical') && Array.isArray(block.childBlocks)) {
    payload.childBlocks = block.childBlocks.slice(0, 2).map((child) => ({
      type: ((typeof child?.type === 'string' && child.type.trim()) ? child.type : 'top_video') as LeafBlockType,
      title: typeof child?.title === 'string' ? child.title : '',
      body: typeof child?.body === 'string' ? child.body : '',
      categoryId: typeof child?.categoryId === 'string' ? child.categoryId : null,
    }))
  }
  return payload
}

const serializeHomepageState = () => JSON.stringify({
  featuredVideoIds: featuredSlots.value.map((v) => v?.id).filter((v): v is string => Boolean(v)),
  layoutBlocks: layoutBlocks.value.map((block) => sanitizeBlockForSave(block)),
  categoryOrder: categories.value.map((category) => ({ id: category.id, sortOrder: category.sort_order })),
})

const applyHomepageBaseline = () => {
  homepageBaseline.value = serializeHomepageState()
}

const nudgeCategoryOrder = (idx: number, direction: -1 | 1) => {
  const swapIdx = idx + direction
  if (swapIdx < 0 || swapIdx >= categories.value.length) return
  const next = [...categories.value]
  const moved = next.splice(idx, 1)[0]
  if (!moved) return
  next.splice(swapIdx, 0, moved)
  const itemAtIdx = next[idx]
  const itemAtSwapIdx = next[swapIdx]
  if (!itemAtIdx || !itemAtSwapIdx) return
  const temp = itemAtIdx.sort_order
  next[idx] = { ...itemAtIdx, sort_order: itemAtSwapIdx.sort_order }
  next[swapIdx] = { ...itemAtSwapIdx, sort_order: temp }
  categories.value = next
}

const resetLivestreamModal = () => {
  livestreamModal.value = {
    open: false,
    saving: false,
    error: '',
    form: {
      title: '',
      description: '',
      slug: '',
      status: 'draft',
      publishStatus: 'draft',
      moqEndpoint: '',
      moqBroadcast: '',
    },
  }
}

const openLivestreamModal = () => {
  livestreamModal.value.open = true
  livestreamModal.value.error = ''
}

const closeLivestreamModal = () => {
  resetLivestreamModal()
}

const createLivestream = async () => {
  const title = livestreamModal.value.form.title.trim()
  if (!title) {
    livestreamModal.value.error = 'Title is required.'
    return
  }
  const moqEndpoint = livestreamModal.value.form.moqEndpoint.trim()
  const moqBroadcast = livestreamModal.value.form.moqBroadcast.trim()
  if (!moqEndpoint) {
    livestreamModal.value.error = 'MoQ endpoint is required.'
    return
  }
  if (!moqBroadcast) {
    livestreamModal.value.error = 'MoQ broadcast name is required.'
    return
  }
  livestreamModal.value.saving = true
  livestreamModal.value.error = ''
  try {
    const payload = {
      title,
      description: livestreamModal.value.form.description.trim() || null,
      slug: livestreamModal.value.form.slug.trim() || null,
      status: livestreamModal.value.form.status,
      publishStatus: livestreamModal.value.form.publishStatus,
      moqEndpoint,
      moqBroadcast,
    }
    const res = await fetch(`${config.public.apiUrl}/api/admin/videos/livestreams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    showToast('success', 'Livestream video created with MoQ playback settings.')
    resetLivestreamModal()
    await loadVideos()
  } catch (e: any) {
    livestreamModal.value.error = e.message || 'Failed to create livestream'
  } finally {
    livestreamModal.value.saving = false
  }
}

const loadMediaConvertConfig = async () => {
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/videos/uploads/mediaconvert/config`, {
      headers: authHeader(),
    })
    if (!res.ok) {
      mediaConvertConfig.value = { enabled: false, configured: false, tusConfigured: false }
      return
    }
    const data = await res.json().catch(() => ({}))
    mediaConvertConfig.value = {
      enabled: Boolean(data?.enabled),
      configured: Boolean(data?.configured),
      tusConfigured: Boolean(data?.tusConfigured),
    }
  } catch {
    mediaConvertConfig.value = { enabled: false, configured: false, tusConfigured: false }
  }
}

const onMediaUploadFileChange = (event: Event) => {
  if (mediaUpload.value.busy) return
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  mediaUpload.value.file = file
  mediaUpload.value.error = false
  mediaUpload.value.progress = 0
  mediaUpload.value.status = 'uploaded'
  mediaUpload.value.message = ''
  if (!file) return
  if (!mediaUpload.value.title.trim()) {
    mediaUpload.value.title = file.name.replace(/\.[^.]+$/, '')
  }
}

const startMediaConvertUpload = async () => {
  const file = mediaUpload.value.file
  if (!file) {
    showToast('error', 'Select a source video first.')
    return
  }
  mediaUpload.value.busy = true
  mediaUpload.value.error = false
  mediaUpload.value.message = ''
  mediaUpload.value.progress = 0
  mediaUpload.value.status = 'uploading'
  try {
    const prepareRes = await fetch(`${config.public.apiUrl}/api/admin/videos/uploads/mediaconvert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
        fileSize: file.size,
        title: mediaUpload.value.title.trim() || file.name.replace(/\.[^.]+$/, ''),
        description: mediaUpload.value.description.trim(),
        durationSeconds: 0,
      }),
    })
    const prepareData = await prepareRes.json().catch(() => ({}))
    if (!prepareRes.ok) throw new Error(prepareData.error || `HTTP ${prepareRes.status}`)
    if (!prepareData?.upload?.endpoint || !prepareData?.job?.id) {
      throw new Error('Upload session could not be created.')
    }
    const uploadInputKey = String(prepareData.upload?.metadata?.inputkey || '')
    const uploadVideoId = String(prepareData.upload?.metadata?.videoid || '')
    const uploadJobId = String(prepareData.job?.id || '')
    const uploadFingerprintScope = uploadInputKey || uploadVideoId || uploadJobId

    await new Promise<void>((resolve, reject) => {
      const upload = new TusUpload(file, {
        endpoint: String(prepareData.upload.endpoint),
        retryDelays: [0, 1000, 3000, 5000],
        chunkSize: 8 * 1024 * 1024,
        fingerprint: async (currentFile) => `${currentFile.name}-${currentFile.type}-${currentFile.size}-${currentFile.lastModified}-${uploadFingerprintScope}`,
        metadata: {
          filename: String(prepareData.upload?.metadata?.filename || file.name),
          filetype: String(prepareData.upload?.metadata?.filetype || file.type || 'application/octet-stream'),
          inputkey: uploadInputKey,
          videoid: uploadVideoId,
        },
        headers: (prepareData.upload?.headers && typeof prepareData.upload.headers === 'object')
          ? prepareData.upload.headers
          : {},
        onError: (error) => reject(error),
        onProgress: (uploaded, total) => {
          if (!total) return
          mediaUpload.value.progress = Math.min(100, Math.round((uploaded / total) * 100))
        },
        onSuccess: () => {
          mediaUpload.value.progress = 100
          resolve()
        },
      })
      upload.findPreviousUploads().then((previousUploads) => {
        if (previousUploads.length) upload.resumeFromPreviousUpload(previousUploads[0]!)
        upload.start()
      }).catch(reject)
    })

    mediaUpload.value.status = 'uploaded'
    const completeRes = await fetch(`${config.public.apiUrl}/api/admin/videos/uploads/mediaconvert/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ jobId: prepareData.job.id }),
    })
    const completeData = await completeRes.json().catch(() => ({}))
    if (!completeRes.ok) throw new Error(completeData.error || `HTTP ${completeRes.status}`)
    mediaUpload.value.message = `Queued MediaConvert job ${completeData?.awsJobId || ''}`.trim()
    await loadVideos()
    showToast('success', 'Source uploaded and queued for MediaConvert.')
  } catch (error: any) {
    mediaUpload.value.error = true
    mediaUpload.value.status = 'failed'
    mediaUpload.value.message = error?.message || 'Upload failed'
    showToast('error', mediaUpload.value.message)
  } finally {
    mediaUpload.value.busy = false
  }
}

const loadVideos = async () => {
  videosLoading.value = true
  try {
    const res  = await fetch(`${config.public.apiUrl}/api/admin/videos`, { headers: authHeader() })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      throw new Error(err.details || err.error || `HTTP ${res.status}`)
    }
    const data = await res.json()
    uploads.value = data.videos || []
    for (const video of uploads.value) {
      previewLockByVideoId.value[video.id] = video.preview_duration
    }
    await hydrateActualDurations()
  } catch (e: any) {
    saveMessage.value = `Failed to load videos: ${e.message}`
    saveMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    videosLoading.value = false
  }
}

const loadCategories = async () => {
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/categories`, { headers: authHeader() })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    const data = await res.json()
    const loaded = Array.isArray(data.categories) ? data.categories : []
    categories.value = loaded.map((cat: any) => ({
      ...cat,
      homepage_layout_variant: cat?.homepage_layout_variant === 'side_mini' ? 'side_mini' : 'three_by_one',
    }))
  } catch (e: any) {
    saveMessage.value = `Failed to load categories: ${e.message}`
    saveMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  }
}

const updateVideoCategory = async (video: Video, nextCategoryId: string) => {
  const previousCategoryId = video.category_id ?? null
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/videos/${video.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ categoryId: nextCategoryId || null }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    const { video: updated } = await res.json()
    const idx = uploads.value.findIndex(v => v.id === video.id)
    if (idx !== -1) {
      const cur = uploads.value[idx]!
      uploads.value[idx] = { ...cur, category_id: updated?.category_id ?? null }
    }
    showToast('success', `Category updated for ${video.title}.`)
    await loadCategories()
  } catch (e: any) {
    const idx = uploads.value.findIndex(v => v.id === video.id)
    if (idx !== -1) {
      const cur = uploads.value[idx]!
      uploads.value[idx] = { ...cur, category_id: previousCategoryId }
    }
    showToast('error', `Failed to update category: ${e.message}`)
  }
}

const createCategory = async () => {
  try {
    const payload = {
      name: categoryForm.value.name.trim(),
      slug: categoryForm.value.slug.trim(),
      sortOrder: Number.parseInt(String(categoryForm.value.sortOrder), 10) || 0,
      direction: categoryForm.value.direction,
      homepageLayoutVariant: categoryForm.value.homepageLayoutVariant || 'three_by_one',
    }
    const res = await fetch(`${config.public.apiUrl}/api/admin/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    categoryForm.value = { name: '', slug: '', sortOrder: 0, direction: 'desc', homepageLayoutVariant: 'three_by_one' }
    showToast('success', 'Category created.')
    await loadCategories()
  } catch (e: any) {
    showToast('error', `Failed to create category: ${e.message}`)
  }
}

const updateCategory = async (category: Category) => {
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/categories`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        id: category.id,
        name: category.name,
        slug: category.slug,
        sortOrder: category.sort_order,
        direction: category.direction,
        homepageLayoutVariant: category.homepage_layout_variant || 'three_by_one',
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    showToast('success', 'Category updated.')
    await loadCategories()
  } catch (e: any) {
    await loadCategories()
    showToast('error', `Failed to update category: ${e.message}`)
  }
}

const deleteCategory = async (category: Category) => {
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/categories`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ id: category.id }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    showToast('success', 'Category deleted.')
    await Promise.all([loadCategories(), loadVideos()])
  } catch (e: any) {
    showToast('error', `Failed to delete category: ${e.message}`)
  }
}

const confirmDeleteCategory = async (category: Category) => {
  const confirmed = window.confirm(`Delete category "${category.name}"? This action cannot be undone.`)
  if (!confirmed) return
  await deleteCategory(category)
}

const loadHomepagePlacement = async () => {
  const res = await fetch(`${config.public.apiUrl}/api/homepage/placement`)
  if (!res.ok) return
  homepagePlacement.value = await res.json()
}

const loadHomepageState = async () => {
  const auth = authHeader()
  const res = await fetch(`${config.public.apiUrl}/api/admin/homepage/content`, {
    headers: Object.keys(auth).length ? auth : undefined,
  })
  if (!res.ok) {
    return
  }
  const data = await res.json()
  const homepageConfig = data?.homepageConfig ?? {}
  const featuredIds: string[] = Array.isArray(homepageConfig.featuredVideoIds) ? homepageConfig.featuredVideoIds : []
  layoutBlocks.value = Array.isArray(homepageConfig.layoutBlocks) && homepageConfig.layoutBlocks.length
    ? homepageConfig.layoutBlocks.map(normalizeLoadedBlock).filter((block: LayoutBlock | null): block is LayoutBlock => Boolean(block))
    : getDefaultBlocks()
  if (!layoutBlocks.value.length) {
    featuredSlots.value = [null, null, null, null]
    applyHomepageBaseline()
    return
  }
  if (Array.isArray(data?.categories) && data.categories.length) {
    categories.value = data.categories
  }
  const nextSlots = featuredIds
    .map((id) => chronologicallySortedUploads.value.find((v) => v.id === id) || null)
    .slice(0, 4)
  while (nextSlots.length < 4) nextSlots.push(chronologicallySortedUploads.value[nextSlots.length] || null)
  featuredSlots.value = nextSlots
  applyHomepageBaseline()
}

const loadNewsletterSettings = async () => {
  if (!isAdmin.value) return
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/newsletter/settings`, { headers: authHeader() })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    const data = await res.json()
    newsletterListId.value = data.brevoSubscriberListId != null ? String(data.brevoSubscriberListId) : ''
    newsletterSenderEmail.value = data.brevoCampaignSenderEmail ?? ''
    newsletterSenderName.value = data.brevoCampaignSenderName ?? ''
    const poll = Number(data.brevoNewsletterPollIntervalMs)
    newsletterPollIntervalMs.value = Number.isFinite(poll) && poll >= 60_000 ? poll : 600_000
  } catch (e: any) {
    newsletterMessage.value = `Could not load newsletter settings: ${e.message}`
    newsletterMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  }
}

const loadNewsletterTemplates = async () => {
  if (!isAdmin.value) return
  const res = await fetch(`${config.public.apiUrl}/api/admin/newsletter/templates`, { headers: authHeader() })
  if (!res.ok) return
  const data = await res.json()
  newsletterTemplates.value = data.templates || []
}

const loadNewsletterCampaigns = async () => {
  if (!isAdmin.value) return
  const res = await fetch(`${config.public.apiUrl}/api/admin/newsletter/campaigns`, { headers: authHeader() })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
    const code = typeof data.code === 'string' ? data.code : ''
    const brevo = data.brevoStatus != null ? ` · Brevo HTTP ${data.brevoStatus}` : ''
    throw new Error(code ? `${msg} (${code})${brevo}` : `${msg}${brevo}`)
  }
  newsletterCampaigns.value = data.campaigns || []
}

const isNewsletterTabActive = computed(() => activeAdminTab.value === 'newsletter')

const { lastCampaignsOkAt, lastCampaignsError } = useAdminNewsletterPolling({
  pollIntervalMs: newsletterPollIntervalMs,
  isActive: isNewsletterTabActive,
  isAdmin,
  loadCampaigns: loadNewsletterCampaigns,
})

const syncNewsletterRecipients = async () => {
  newsletterSyncing.value = true
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/newsletter/sync`, {
      method: 'POST',
      headers: authHeader(),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    newsletterMessage.value = `Sync complete. Recipients synced: ${data.synced}`
    newsletterMessageClass.value = 'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200'
  } catch (e: any) {
    newsletterMessage.value = e.message || 'Sync failed'
    newsletterMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    newsletterSyncing.value = false
  }
}

const resetNewsletterTemplateForm = () => {
  newsletterEditingTemplateId.value = null
  newsletterTemplateForm.value = { name: '', subject: '', htmlBody: '' }
}

const startEditNewsletterTemplate = (tpl: { id: string; name: string; subject: string; html_body: string }) => {
  newsletterEditingTemplateId.value = tpl.id
  newsletterTemplateForm.value = {
    name: tpl.name,
    subject: tpl.subject,
    htmlBody: tpl.html_body,
  }
}

const saveNewsletterTemplate = async () => {
  if (!isAdmin.value) return
  const { name, subject, htmlBody } = newsletterTemplateForm.value
  if (!name.trim() || !subject.trim() || !htmlBody.trim()) {
    newsletterMessage.value = 'Template name, subject, and HTML body are required.'
    newsletterMessageClass.value = 'border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-100'
    return
  }
  newsletterTemplateSaving.value = true
  newsletterMessage.value = ''
  try {
    const editing = newsletterEditingTemplateId.value
    const url = editing
      ? `${config.public.apiUrl}/api/admin/newsletter/templates/${encodeURIComponent(editing)}`
      : `${config.public.apiUrl}/api/admin/newsletter/templates`
    const res = await fetch(url, {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(
        editing
          ? { name: name.trim(), subject: subject.trim(), htmlBody }
          : { name: name.trim(), subject: subject.trim(), htmlBody },
      ),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`)
    await loadNewsletterTemplates()
    resetNewsletterTemplateForm()
    newsletterMessage.value = editing ? 'Template updated.' : 'Template created.'
    newsletterMessageClass.value = 'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200'
  } catch (e: any) {
    newsletterMessage.value = e.message || 'Could not save template'
    newsletterMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    newsletterTemplateSaving.value = false
  }
}

const deleteNewsletterTemplate = async (id: string, name: string) => {
  if (!isAdmin.value) return
  const ok = window.confirm(`Delete template "${name}"? This cannot be undone.`)
  if (!ok) return
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/newsletter/templates/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authHeader(),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`)
    if (newsletterTemplateId.value === id) newsletterTemplateId.value = ''
    if (newsletterEditingTemplateId.value === id) resetNewsletterTemplateForm()
    await loadNewsletterTemplates()
    newsletterMessage.value = 'Template deleted.'
    newsletterMessageClass.value = 'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200'
  } catch (e: any) {
    newsletterMessage.value = e.message || 'Delete failed'
    newsletterMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  }
}

const loadHomepageContent = async () => {
  if (!isAdmin.value) return
  await loadHomepageState()
}

const loadSystemFeatures = async () => {
  if (!isAdmin.value) return
  systemFeaturesMessage.value = ''
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/system/features`, { headers: authHeader() })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    systemFeatures.value = {
      promotionsEnabled: Boolean(data.promotionsEnabled),
      isicEnabled: Boolean(data.isicEnabled),
      freePodcastPreviewEnabled: Boolean(data.freePodcastPreviewEnabled),
      videoUploaderEnabled: data.videoUploaderEnabled !== false,
    }
    // Keep ISIC API enable checkbox in sync with feature toggle.
    isicApiConfig.value.enabled = systemFeatures.value.isicEnabled
  } catch (e: any) {
    systemFeaturesMessage.value = `Could not load system feature toggles: ${e.message}`
    systemFeaturesMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  }
}

const saveSystemFeatures = async () => {
  if (!isAdmin.value) return
  systemFeaturesSaving.value = true
  systemFeaturesMessage.value = ''
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/system/features`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(systemFeatures.value),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    systemFeaturesMessage.value = 'Feature toggles saved.'
    systemFeaturesMessageClass.value = 'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200'
    await loadSystemFeatures()
  } catch (e: any) {
    systemFeaturesMessage.value = e.message || 'Failed to save feature toggles'
    systemFeaturesMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    systemFeaturesSaving.value = false
  }
}

const loadReplicationStatus = async (options?: { preserveMessage?: boolean; probe?: boolean }) => {
  if (!isAdmin.value) return
  if (!options?.preserveMessage) {
    replicationMessage.value = ''
  }
  try {
    const probeQuery = options?.probe ? '?probe=1' : ''
    const res = await fetch(`${config.public.apiUrl}/api/admin/replication${probeQuery}`, { headers: authHeader() })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    replicationStatus.value = {
      mode: String(data.mode || 'd1_to_pg'),
      batchSize: Number(data.batchSize) || 100,
      targetConfigured: Boolean(data.targetConfigured),
      targetIngestPathOk: data.targetIngestPathOk !== false,
      targetResolvedPath: data.targetResolvedPath ? String(data.targetResolvedPath) : undefined,
      targetWarning: data.targetWarning ? String(data.targetWarning) : null,
      targetProbe: data.targetProbe && typeof data.targetProbe === 'object'
        ? { ok: Boolean(data.targetProbe.ok), error: data.targetProbe.error ? String(data.targetProbe.error) : undefined }
        : null,
      streams: Array.isArray(data.streams) ? data.streams : [],
    }
  } catch (e: any) {
    replicationStatus.value = null
    replicationMessage.value = `Could not load replication status: ${e.message}`
    replicationMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  }
}

const resetReplicationCursors = async () => {
  if (!isAdmin.value) return
  if (!import.meta.client || !window.confirm('Reset replication sync cursors? The next push will re-send all rows from D1.')) return
  replicationResetting.value = true
  replicationMessage.value = ''
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/replication`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ resetCursors: true }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    replicationMessage.value = 'Replication cursors reset. Run Push DB to Deno Postgres to re-sync.'
    replicationMessageClass.value = 'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200'
    await loadReplicationStatus({ preserveMessage: true, probe: true })
  } catch (e: any) {
    replicationMessage.value = e.message || 'Failed to reset cursors'
    replicationMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    replicationResetting.value = false
  }
}

const pushReplicationToDeno = async () => {
  if (!isAdmin.value) return
  if (replicationResetting.value) return
  replicationPushing.value = true
  replicationMessage.value = ''
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/replication/push`, {
      method: 'POST',
      headers: authHeader(),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    const t = data.totals || {}
    const parts = [
      t.users ? `${t.users} users` : '',
      t.subscriptions ? `${t.subscriptions} subscriptions` : '',
      t.videos ? `${t.videos} videos` : '',
      t.adminSettings ? `${t.adminSettings} settings` : '',
    ].filter(Boolean)
    const detail = parts.length ? parts.join(', ') : 'no new rows'
    const ingest = data.ingest
    const ingestNote = ingest && (ingest.applied > 0 || ingest.skipped > 0)
      ? ` Postgres applied ${ingest.applied ?? 0}, skipped ${ingest.skipped ?? 0}.`
      : ''
    replicationMessage.value = data.partial
      ? `${data.message || 'Partial push.'} Read from D1: ${detail}.${ingestNote}`
      : `Push complete (${data.rounds ?? 0} round(s)). Read from D1: ${detail}.${ingestNote}`
    replicationMessageClass.value = data.partial
      ? 'border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-100'
      : 'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200'
    await loadReplicationStatus({ preserveMessage: true })
  } catch (e: any) {
    replicationMessage.value = e.message || 'DB push failed'
    replicationMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    replicationPushing.value = false
  }
}

const loadMediaConvertSystemSettings = async () => {
  if (!isAdmin.value) return
  mediaConvertSystemMessage.value = ''
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/system/mediaconvert`, { headers: authHeader() })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    mediaConvertSystem.value = {
      enabled: Boolean(data.enabled),
      awsRegion: String(data.awsRegion || ''),
      awsAccessKeyId: String(data.awsAccessKeyId || ''),
      awsSecretAccessKey: '',
      hasAwsSecret: Boolean(data?.secrets?.awsSecretAccessKeyMasked),
      awsSessionToken: '',
      hasAwsSession: Boolean(data?.secrets?.awsSessionTokenMasked),
      endpoint: String(data.endpoint || ''),
      roleArn: String(data.roleArn || ''),
      inputBucket: String(data.inputBucket || ''),
      outputBucket: String(data.outputBucket || ''),
      inputPrefix: String(data.inputPrefix || 'mediaconvert-input'),
      outputPrefix: String(data.outputPrefix || 'mediaconvert-output'),
      tusEndpoint: String(data.tusEndpoint || ''),
      tusAuthToken: '',
      hasTusAuth: Boolean(data?.secrets?.tusAuthTokenMasked),
    }
  } catch (e: any) {
    mediaConvertSystemMessage.value = `Could not load MediaConvert settings: ${e.message}`
    mediaConvertSystemMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  }
}

const saveMediaConvertSystemSettings = async () => {
  if (!isAdmin.value) return
  mediaConvertSystemSaving.value = true
  mediaConvertSystemMessage.value = ''
  try {
    const payload: Record<string, unknown> = {
      enabled: mediaConvertSystem.value.enabled,
      awsRegion: mediaConvertSystem.value.awsRegion,
      awsAccessKeyId: mediaConvertSystem.value.awsAccessKeyId,
      endpoint: mediaConvertSystem.value.endpoint,
      roleArn: mediaConvertSystem.value.roleArn,
      inputBucket: mediaConvertSystem.value.inputBucket,
      outputBucket: mediaConvertSystem.value.outputBucket,
      inputPrefix: mediaConvertSystem.value.inputPrefix,
      outputPrefix: mediaConvertSystem.value.outputPrefix,
      tusEndpoint: mediaConvertSystem.value.tusEndpoint,
    }
    if (mediaConvertSystem.value.awsSecretAccessKey.trim()) payload.awsSecretAccessKey = mediaConvertSystem.value.awsSecretAccessKey.trim()
    if (mediaConvertSystem.value.awsSessionToken.trim()) payload.awsSessionToken = mediaConvertSystem.value.awsSessionToken.trim()
    if (mediaConvertSystem.value.tusAuthToken.trim()) payload.tusAuthToken = mediaConvertSystem.value.tusAuthToken.trim()
    const res = await fetch(`${config.public.apiUrl}/api/admin/system/mediaconvert`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    mediaConvertSystemMessage.value = 'MediaConvert settings saved.'
    mediaConvertSystemMessageClass.value = 'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200'
    await Promise.all([loadMediaConvertSystemSettings(), loadMediaConvertConfig()])
  } catch (e: any) {
    mediaConvertSystemMessage.value = e.message || 'Failed to save MediaConvert settings'
    mediaConvertSystemMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    mediaConvertSystemSaving.value = false
  }
}

const loadPaymentSettings = async () => {
  if (!isAdmin.value) return
  paymentSettingsMessage.value = ''
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/payments/settings`, { headers: authHeader() })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    const data = await res.json()
    const enabled = Array.isArray(data.enabledProviders) ? data.enabledProviders.filter((p: string) => p === 'stripe' || p === 'gocardless') : ['stripe']
    const order = Array.isArray(data.providerOrder) ? data.providerOrder.filter((p: string) => p === 'stripe' || p === 'gocardless') : []
    const first: PaymentProvider = order[0] === 'gocardless' ? 'gocardless' : 'stripe'
    const second: PaymentProvider = order[1] === 'stripe' || order[1] === 'gocardless' ? order[1] : (first === 'stripe' ? 'gocardless' : 'stripe')
    const allowed = Array.isArray(data.allowedPlans) ? data.allowedPlans.filter((p: string) => p === 'monthly' || p === 'yearly' || p === 'club') : ['monthly', 'yearly', 'club']
    paymentSettings.value = {
      enabledProviders: enabled.length ? enabled : ['stripe'],
      providerOrder: [first, second],
      allowedPlans: allowed.length ? allowed : ['monthly', 'yearly', 'club'],
      basePrices: {
        monthly: data.basePrices?.monthly != null ? String(data.basePrices.monthly) : '',
        yearly: data.basePrices?.yearly != null ? String(data.basePrices.yearly) : '',
        club: data.basePrices?.club != null ? String(data.basePrices.club) : '',
      },
      providerPrices: {
        stripe: {
          monthly: data.providerPrices?.stripe?.monthly != null ? String(data.providerPrices.stripe.monthly) : '',
          yearly: data.providerPrices?.stripe?.yearly != null ? String(data.providerPrices.stripe.yearly) : '',
          club: data.providerPrices?.stripe?.club != null ? String(data.providerPrices.stripe.club) : '',
        },
        gocardless: {
          monthly: data.providerPrices?.gocardless?.monthly != null ? String(data.providerPrices.gocardless.monthly) : '',
          yearly: data.providerPrices?.gocardless?.yearly != null ? String(data.providerPrices.gocardless.yearly) : '',
          club: data.providerPrices?.gocardless?.club != null ? String(data.providerPrices.gocardless.club) : '',
        },
      },
      stripePriceIds: {
        monthly: data.stripePriceIds?.monthly != null ? String(data.stripePriceIds.monthly) : '',
        yearly: data.stripePriceIds?.yearly != null ? String(data.stripePriceIds.yearly) : '',
        club: data.stripePriceIds?.club != null ? String(data.stripePriceIds.club) : '',
      },
    }
  } catch (e: any) {
    paymentSettingsMessage.value = `Could not load payment settings: ${e.message}`
    paymentSettingsMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  }
}

const loadPromotions = async () => {
  if (!isAdmin.value) return
  promotionsLoading.value = true
  promotionsMessage.value = ''
  try {
    const [campaignRes, codeRes] = await Promise.all([
      fetch(`${config.public.apiUrl}/api/admin/promotions/campaigns`, { headers: authHeader() }),
      fetch(`${config.public.apiUrl}/api/admin/promotions/codes`, { headers: authHeader() }),
    ])
    const campaignData = await campaignRes.json().catch(() => ({}))
    const codeData = await codeRes.json().catch(() => ({}))
    if (!campaignRes.ok) throw new Error(campaignData.error || `HTTP ${campaignRes.status}`)
    if (!codeRes.ok) throw new Error(codeData.error || `HTTP ${codeRes.status}`)
    promoCampaigns.value = Array.isArray(campaignData.campaigns) ? campaignData.campaigns : []
    promoCodes.value = Array.isArray(codeData.codes) ? codeData.codes : []
    if (!promoCodeForm.value.campaignId && promoCampaigns.value.length) {
      promoCodeForm.value.campaignId = String(promoCampaigns.value[0]?.id || '')
    }
  } catch (e: any) {
    promotionsMessage.value = e.message || 'Failed to load promotions'
    promotionsMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    promotionsLoading.value = false
  }
}

const createPromoCampaign = async () => {
  if (!isAdmin.value) return
  const name = promoCampaignForm.value.name.trim()
  if (!name) {
    promotionsMessage.value = 'Campaign name is required.'
    promotionsMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
    return
  }
  promotionsSaving.value = true
  promotionsMessage.value = ''
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/promotions/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        name,
        description: promoCampaignForm.value.description,
        isActive: promoCampaignForm.value.isActive,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    promoCampaignForm.value = { name: '', description: '', isActive: true }
    promotionsMessage.value = 'Promo campaign created.'
    promotionsMessageClass.value = 'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200'
    await loadPromotions()
  } catch (e: any) {
    promotionsMessage.value = e.message || 'Failed to create campaign'
    promotionsMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    promotionsSaving.value = false
  }
}

const createPromoCodes = async () => {
  if (!isAdmin.value) return
  if (!promoCodeForm.value.campaignId) {
    promotionsMessage.value = 'Choose a campaign first.'
    promotionsMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
    return
  }
  const stripeCouponId = promoCodeForm.value.stripeCouponId.trim()
  const gocardlessDiscountPercentRaw = promoCodeForm.value.gocardlessDiscountPercent
  const gocardlessDiscountPercent = gocardlessDiscountPercentRaw === ''
    ? null
    : Number(gocardlessDiscountPercentRaw)
  if (promoCodeForm.value.rewardType === 'discount_percent'
      && !stripeCouponId
      && !(Number.isFinite(gocardlessDiscountPercent) && gocardlessDiscountPercent! > 0 && gocardlessDiscountPercent! <= 100)) {
    promotionsMessage.value = 'For discount_percent rewards, set a Stripe coupon ID and/or GoCardless discount %.'
    promotionsMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
    return
  }
  promotionsSaving.value = true
  promotionsMessage.value = ''
  try {
    const expiresIso = parseOptionalLocalDateTimeToIso(promoCodeForm.value.expiresAt)
    const res = await fetch(`${config.public.apiUrl}/api/admin/promotions/codes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        campaignId: promoCodeForm.value.campaignId,
        code: promoCodeForm.value.code,
        quantity: promoCodeForm.value.quantity,
        rewardType: promoCodeForm.value.rewardType,
        maxUses: promoCodeForm.value.maxUses,
        allowedPlanTypes: promoCodeForm.value.allowedPlanTypes,
        stripeCouponId,
        gocardlessDiscountPercent,
        gocardlessPlanCode: promoCodeForm.value.gocardlessPlanCode.trim(),
        expiresAt: expiresIso,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    const created = Number(data.created || 0)
    const codes = Array.isArray(data.codes) ? data.codes : []
    promotionsMessage.value = created > 0
      ? `Created ${created} promo code(s): ${codes.join(', ')}`
      : 'Promo code request completed.'
    promotionsMessageClass.value = 'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200'
    promoCodeForm.value = {
      campaignId: promoCodeForm.value.campaignId,
      code: '',
      quantity: 1,
      rewardType: 'free_month',
      maxUses: 1,
      allowedPlanTypes: ['monthly', 'yearly', 'club'],
      stripeCouponId: '',
      gocardlessDiscountPercent: '',
      gocardlessPlanCode: '',
      expiresAt: '',
    }
    await loadPromotions()
  } catch (e: any) {
    promotionsMessage.value = e.message || 'Failed to create promo code(s)'
    promotionsMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    promotionsSaving.value = false
  }
}

const loadIsicCampaigns = async () => {
  if (!isAdmin.value) return
  isicLoading.value = true
  isicMessage.value = ''
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/isic/campaigns`, { headers: authHeader() })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    isicCampaigns.value = Array.isArray(data.campaigns) ? data.campaigns : []
    const apiConfig = data.apiConfig || {}
    isicApiConfig.value = {
      enabled: Boolean(apiConfig.enabled),
      baseUrl: String(apiConfig.baseUrl || ''),
      apiKey: '',
      hasApiKey: Boolean(apiConfig.hasApiKey),
    }
  } catch (e: any) {
    isicMessage.value = e.message || 'Failed to load ISIC settings'
    isicMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    isicLoading.value = false
  }
}

const saveIsicApiConfig = async () => {
  if (!isAdmin.value) return
  if (!isicApiConfig.value.enabled) {
    isicMessage.value = 'ISIC feature is disabled.'
    isicMessageClass.value = 'border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-100'
    return
  }
  if (!isicApiConfig.value.baseUrl.trim()) {
    isicMessage.value = 'ISIC API base URL is required when ISIC is enabled.'
    isicMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
    return
  }
  if (!isicApiConfig.value.hasApiKey && !isicApiConfig.value.apiKey.trim()) {
    isicMessage.value = 'Provide an ISIC API key when enabling ISIC.'
    isicMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
    return
  }
  isicSaving.value = true
  isicMessage.value = ''
  try {
    const apiConfigPayload: any = {
      enabled: isicApiConfig.value.enabled,
      baseUrl: isicApiConfig.value.baseUrl.trim(),
    }
    const trimmedApiKey = isicApiConfig.value.apiKey.trim()
    if (trimmedApiKey) {
      apiConfigPayload.apiKey = trimmedApiKey
    }
    const res = await fetch(`${config.public.apiUrl}/api/admin/isic/campaigns`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        apiConfig: apiConfigPayload,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    isicMessage.value = 'ISIC API configuration saved.'
    isicMessageClass.value = 'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200'
    isicApiConfig.value.apiKey = ''
    await loadIsicCampaigns()
  } catch (e: any) {
    isicMessage.value = e.message || 'Failed to save ISIC API configuration'
    isicMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    isicSaving.value = false
  }
}

const createIsicCampaign = async () => {
  if (!isAdmin.value) return
  const name = isicCampaignForm.value.name.trim()
  if (!name) {
    isicMessage.value = 'ISIC campaign name is required.'
    isicMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
    return
  }
  isicSaving.value = true
  isicMessage.value = ''
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/isic/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        name,
        description: isicCampaignForm.value.description,
        isActive: isicCampaignForm.value.isActive,
        freeSlotsLimit: isicCampaignForm.value.freeSlotsLimit,
        discountPercent: isicCampaignForm.value.discountPercent,
        renewalMonths: isicCampaignForm.value.renewalMonths,
        popupBehavior: isicCampaignForm.value.popupBehavior,
        countryScope: isicCampaignForm.value.countryScope,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    isicCampaignForm.value = {
      name: '',
      description: '',
      isActive: true,
      freeSlotsLimit: 5000,
      discountPercent: 0,
      renewalMonths: 12,
      popupBehavior: 'highlight_campaign',
      countryScope: 'CZ,SK',
    }
    isicMessage.value = 'ISIC campaign created.'
    isicMessageClass.value = 'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200'
    await loadIsicCampaigns()
  } catch (e: any) {
    isicMessage.value = e.message || 'Failed to create ISIC campaign'
    isicMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    isicSaving.value = false
  }
}

const loadSiteBranding = async () => {
  if (!isAdmin.value) return
  siteBrandingMessage.value = ''
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/site-settings`, { headers: authHeader() })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    const data = await res.json()
    siteBranding.value = {
      site_name: data.site_name || '',
      site_name_short: data.site_name_short || '',
      site_description: data.site_description || '',
      site_logo_url: data.site_logo_url || '',
      site_favicon_url: data.site_favicon_url || '',
      podcast_title: data.podcast_title || '',
      podcast_description: data.podcast_description || '',
    }
  } catch (e: any) {
    siteBrandingMessage.value = `Could not load site branding: ${e.message}`
    siteBrandingMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  }
}

const saveSiteBranding = async () => {
  if (!isAdmin.value) return
  siteBrandingSaving.value = true
  siteBrandingMessage.value = ''
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/site-settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(siteBranding.value),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    siteBrandingMessage.value = 'Site branding saved.'
    siteBrandingMessageClass.value = 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:border-emerald-700 dark:text-emerald-200'
  } catch (e: any) {
    siteBrandingMessage.value = e.message || 'Failed to save site branding'
    siteBrandingMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    siteBrandingSaving.value = false
  }
}

const loadRssPodcastWebhookSettings = async () => {
  if (!isAdmin.value) return
  rssPodcastMessage.value = ''
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/rss/podcast-rebuild-webhook`, { headers: authHeader() })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    const data = await res.json()
    rssPodcastWebhookUrl.value = typeof data.webhookUrl === 'string' ? data.webhookUrl : ''
    rssPodcastSecretConfigured.value = Boolean(data.secretConfigured)
    rssPodcastWebhookSecretInput.value = ''
  } catch (e: any) {
    rssPodcastMessage.value = `Could not load podcast webhook settings: ${e.message}`
    rssPodcastMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  }
}

const saveRssPodcastWebhookSettings = async () => {
  if (!isAdmin.value) return
  if (!systemFeatures.value.freePodcastPreviewEnabled) {
    rssPodcastMessage.value = 'Free podcast preview feed is disabled.'
    rssPodcastMessageClass.value = 'border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-100'
    return
  }
  rssPodcastWebhookSaving.value = true
  rssPodcastMessage.value = ''
  try {
    const webhookUrlTrimmed = rssPodcastWebhookUrl.value.trim()
    if (webhookUrlTrimmed) {
      const parsed = new URL(webhookUrlTrimmed)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Webhook URL must use http:// or https://')
      }
    }
    const body: Record<string, string> = { webhookUrl: webhookUrlTrimmed }
    const sec = rssPodcastWebhookSecretInput.value.trim()
    if (sec) {
      if (sec.length < 16) throw new Error('Webhook secret must be at least 16 characters')
      body.webhookSecret = sec
    }
    const res = await fetch(`${config.public.apiUrl}/api/admin/rss/podcast-rebuild-webhook`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`)
    rssPodcastMessage.value = 'Podcast webhook settings saved.'
    rssPodcastMessageClass.value = 'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200'
    rssPodcastWebhookSecretInput.value = ''
    rssPodcastSecretConfigured.value = Boolean(data.secretConfigured)
  } catch (e: any) {
    rssPodcastMessage.value = e.message || 'Failed to save podcast webhook settings'
    rssPodcastMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    rssPodcastWebhookSaving.value = false
  }
}

const notifyPodcastPreviewRebuild = async () => {
  if (!isAdmin.value) return
  if (!systemFeatures.value.freePodcastPreviewEnabled) {
    rssPodcastMessage.value = 'Free podcast preview feed is disabled.'
    rssPodcastMessageClass.value = 'border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-100'
    return
  }
  rssPodcastNotifySending.value = true
  rssPodcastMessage.value = ''
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/rss/podcast-preview-rebuild`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({}),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const base = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
      const detail = typeof data.detail === 'string' && data.detail.trim() ? ` — ${data.detail.trim()}` : ''
      const status = data.status ? ` (upstream ${data.status})` : ''
      throw new Error(`${base}${status}${detail}`)
    }
    const accepted = Number(data?.acceptedCount ?? data?.videoCount ?? 0)
    const rejected = Number(data?.rejectedCount ?? 0)
    const rejectedItems = Array.isArray(data?.rejected) ? data.rejected : []
    const rejectedText = rejectedItems.length
      ? ` Rejected: ${rejectedItems.slice(0, 3).filter((item: any) => item && typeof item === 'object').map((item: any) => `${item.id || 'unknown'} (${item.reason || 'invalid'})`).join(', ')}`
      : ''
    rssPodcastMessage.value = `Host notified (${accepted} accepted, ${rejected} rejected).${rejectedText}`
    rssPodcastMessageClass.value = 'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200'
  } catch (e: any) {
    rssPodcastMessage.value = e.message || 'Notify failed'
    rssPodcastMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    rssPodcastNotifySending.value = false
  }
}

const savePaymentSettings = async () => {
  if (!isAdmin.value) return
  paymentSettingsSaving.value = true
  paymentSettingsMessage.value = ''
  try {
    const ps = paymentSettings.value
    const enabledProviders = (ps.enabledProviders || []).filter((provider): provider is PaymentProvider =>
      provider === 'stripe' || provider === 'gocardless',
    )
    if (!enabledProviders.length) {
      throw new Error('Enable at least one payment gateway.')
    }
    if (!enabledProviders.includes(paymentPrimaryProvider.value)) {
      throw new Error('Primary payment provider must also be enabled.')
    }
    const secondary = paymentPrimaryProvider.value === 'stripe' ? 'gocardless' : 'stripe'
    const order: PaymentProvider[] = enabledProviders.includes(secondary)
      ? [paymentPrimaryProvider.value, secondary]
      : [paymentPrimaryProvider.value]
    const hasAnyPlan = Array.isArray(ps.allowedPlans) && ps.allowedPlans.length > 0
    if (!hasAnyPlan) {
      throw new Error('Select at least one offered plan.')
    }
    if (enabledProviders.includes('stripe')) {
      const missingStripePriceIds = ps.allowedPlans.filter((plan) => !String(ps.stripePriceIds?.[plan] || '').trim())
      if (missingStripePriceIds.length) {
        throw new Error(`Stripe price IDs are required for enabled plans: ${missingStripePriceIds.join(', ')}`)
      }
    }
    const res = await fetch(`${config.public.apiUrl}/api/admin/payments/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        enabledProviders,
        providerOrder: order,
        allowedPlans: ps.allowedPlans,
        basePrices: ps.basePrices,
        providerPrices: ps.providerPrices,
        stripePriceIds: ps.stripePriceIds,
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    paymentSettingsMessage.value = 'Payment settings saved.'
    paymentSettingsMessageClass.value = 'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200'
    await loadPaymentSettings()
  } catch (e: any) {
    paymentSettingsMessage.value = e.message || 'Failed to save payment settings'
    paymentSettingsMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    paymentSettingsSaving.value = false
  }
}

const loadUsers = async () => {
  if (!isAdmin.value) return
  const reqId = ++usersLoadRequestId
  usersLoading.value = true
  try {
    const params = new URLSearchParams({
      page: String(usersPage.value),
      pageSize: String(usersPageSize.value),
      search: usersSearchDebounced.value.trim(),
      role: usersRoleFilter.value,
      subscription: usersSubscriptionFilter.value,
    })
    const res = await fetch(`${config.public.apiUrl}/api/admin/users?${params.toString()}`, { headers: authHeader() })
    if (reqId !== usersLoadRequestId) return
    if (!res.ok) return
    const data = await res.json()
    if (reqId !== usersLoadRequestId) return
    users.value = ((data.users || []) as AdminUserRow[]).map((row) => ({
      ...row,
      uiRole: undefined,
      uiSubscription: undefined,
    }))
    usersTotal.value = Number(data.total) || 0
    usersTotalPages.value = Math.max(1, Number(data.totalPages) || 1)
  }
  finally {
    if (reqId === usersLoadRequestId) usersLoading.value = false
  }
}

watch(usersSearchInput, () => {
  if (usersSearchDebounceTimer) clearTimeout(usersSearchDebounceTimer)
  usersSearchDebounceTimer = setTimeout(() => {
    usersSearchDebounceTimer = null
    usersSearchDebounced.value = usersSearchInput.value
    usersPage.value = 1
    loadUsers()
  }, 350)
})

function adminUserRoleSelectValue(u: AdminUserRow): string {
  return u.uiRole ?? u.role
}

function adminUserSubscriptionSelectValue(u: AdminUserRow): string {
  return u.uiSubscription ?? (u.subscription_status || 'none')
}

function hasAdminUserSubscriptionRow(u: AdminUserRow): boolean {
  return u.subscription_status != null && u.subscription_status !== ''
}

function userHasTransferableSubscription(u: AdminUserRow): boolean {
  const s = u.subscription_status
  return s === 'active' || s === 'trialing'
}

function openTransferSubscriptionModal(u: AdminUserRow) {
  transferSubModal.value = {
    open: true,
    step: 0,
    sourceUser: u,
    targetEmail: '',
    error: null,
    submitting: false,
  }
}

function closeTransferSubscriptionModal() {
  transferSubModal.value = {
    open: false,
    step: 0,
    sourceUser: null,
    targetEmail: '',
    error: null,
    submitting: false,
  }
}

function goTransferSubscriptionConfirm() {
  const email = transferSubModal.value.targetEmail.trim()
  if (!email || !email.includes('@')) {
    transferSubModal.value.error = 'Enter a valid destination email.'
    return
  }
  if (email.toLowerCase() === transferSubModal.value.sourceUser?.email?.toLowerCase()) {
    transferSubModal.value.error = 'Destination must be a different account.'
    return
  }
  transferSubModal.value.error = null
  transferSubModal.value.step = 1
}

async function executeTransferSubscription() {
  const modal = transferSubModal.value
  const source = modal.sourceUser
  const targetEmail = modal.targetEmail.trim()
  if (!source?.id || !targetEmail) return
  transferSubModal.value.submitting = true
  transferSubModal.value.error = null
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/users/transfer-subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ sourceUserId: source.id, targetEmail }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const code = typeof data.code === 'string' ? data.code : ''
      const messages: Record<string, string> = {
        source_not_found: 'Source user not found.',
        target_not_found: 'No account found with that email.',
        target_has_subscription: 'That account already has an active or trialing subscription.',
        same_user: 'Destination must be a different account.',
        no_active_subscription: 'This account no longer has an active or trialing subscription to transfer.',
        transfer_failed: 'Transfer failed due to an internal error.',
        invalid_email: 'Enter a valid destination email.',
      }
      transferSubModal.value.error = messages[code] || data.error || `Transfer failed (HTTP ${res.status})`
      return
    }
    closeTransferSubscriptionModal()
    await loadUsers()
    showToast('success', `Subscription transferred to ${data.targetEmail || targetEmail}.`)
  } catch (e: unknown) {
    transferSubModal.value.error = e instanceof Error ? e.message : 'Network error during transfer.'
  } finally {
    transferSubModal.value.submitting = false
  }
}

function adminUserSubscriptionSelectDisabled(u: AdminUserRow): boolean {
  if (user.value?.role !== 'super_admin' && u.role === 'super_admin') return true
  return !hasAdminUserSubscriptionRow(u)
}

function adminUserSubscriptionSelectTitle(u: AdminUserRow): string {
  if (user.value?.role !== 'super_admin' && u.role === 'super_admin') {
    return 'Only a super admin may change this account'
  }
  if (!hasAdminUserSubscriptionRow(u)) {
    return 'No subscription row — status cannot be edited'
  }
  return ''
}

function patchUserRowById(userId: string, patch: Partial<AdminUserRow>) {
  const i = users.value.findIndex((x) => x.id === userId)
  if (i === -1) return
  const cur = users.value[i]!
  users.value[i] = { ...cur, ...patch }
}

const updateUser = async (userId: string, patch: Record<string, string>) => {
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/users`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ userId, ...patch }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    if (typeof patch.role === 'string') {
      patchUserRowById(userId, { role: patch.role, uiRole: undefined })
    }
    if (typeof patch.subscriptionStatus === 'string') {
      const s = patch.subscriptionStatus
      const nextSub = s === 'none' ? 'cancelled' : s
      patchUserRowById(userId, { subscription_status: nextSub, uiSubscription: undefined })
    }
    try {
      await loadUsers()
    } catch (e) {
      console.error('loadUsers after user patch:', e)
    }
    showToast('success', 'User updated.')
    return true
  } catch (error: any) {
    console.error('Failed to update user', error)
    showToast('error', `Failed to update user: ${error.message || 'unknown error'}`)
    return false
  }
}

function onUserRoleSelect(u: AdminUserRow, newRole: string) {
  const serverRole = u.role
  if (newRole === serverRole) return
  if (isSensitiveRoleChange(serverRole, newRole)) {
    patchUserRowById(u.id, { uiRole: newRole })
    openConfirmModal({
      mode: 'user_role',
      userId: u.id,
      email: u.email,
      prevRole: serverRole,
      nextRole: newRole,
      prevSubscription: u.subscription_status || 'none',
      nextSubscription: u.subscription_status || 'none',
      impactText: `Change role for ${u.email} from ${serverRole} to ${newRole}? This affects API access immediately.`,
    })
    return
  }
  patchUserRowById(u.id, { uiRole: newRole })
  void (async () => {
    const ok = await updateUser(u.id, { role: newRole })
    if (!ok) patchUserRowById(u.id, { uiRole: undefined })
  })()
}

function onUserSubscriptionSelect(u: AdminUserRow, next: string) {
  if (!hasAdminUserSubscriptionRow(u)) return
  const prev = u.subscription_status || 'none'
  if (next === prev) return
  patchUserRowById(u.id, { uiSubscription: next })
  openConfirmModal({
    mode: 'user_subscription',
    userId: u.id,
    email: u.email,
    prevRole: u.role,
    nextRole: u.role,
    prevSubscription: prev,
    nextSubscription: next,
    impactText: `Change subscription status for ${u.email} from ${prev} to ${next}? This updates their latest subscription row in the database (not Stripe).`,
  })
}

const loadAnalytics = async () => {
  if (!isAdmin.value) return
  analyticsLoading.value = true
  analyticsError.value = ''
  try {
    const params = new URLSearchParams({
      range: analyticsRange.value,
      granularity: analyticsGranularity.value,
      dataset: 'all',
      format: 'json',
    })
    const res = await fetch(`${config.public.apiUrl}/api/admin/analytics?${params.toString()}`, { headers: authHeader() })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    analytics.value = data
    if (!analyticsSettingsInitialized.value) {
      analyticsViewCounting.value.minSegmentsPerSession = Number(data?.viewCounting?.minSegmentsPerSession ?? 1)
      analyticsViewCounting.value.minWatchSeconds = Number(data?.viewCounting?.minWatchSeconds ?? 15)
      analyticsSettingsInitialized.value = true
    }
    analyticsRange.value = data?.meta?.range || analyticsRange.value
    analyticsGranularity.value = data?.meta?.granularity || analyticsGranularity.value
  } catch (error: any) {
    analyticsError.value = error?.message || 'Failed to load analytics'
  } finally {
    analyticsLoading.value = false
  }
}

const saveAnalyticsSettings = async () => {
  if (!isAdmin.value) return
  analyticsSettingsSaving.value = true
  analyticsError.value = ''
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/analytics`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        viewCounting: analyticsViewCounting.value,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    await loadAnalytics()
  } catch (error: any) {
    analyticsError.value = error?.message || 'Failed to save analytics settings'
  } finally {
    analyticsSettingsSaving.value = false
  }
}

const exportAnalytics = async (dataset: AnalyticsDataset) => {
  if (!isAdmin.value || analyticsExporting.value) return
  analyticsExporting.value = dataset
  analyticsError.value = ''
  try {
    const params = new URLSearchParams({
      range: analyticsRange.value,
      granularity: analyticsGranularity.value,
      dataset,
      format: 'csv',
    })
    const res = await fetch(`${config.public.apiUrl}/api/admin/analytics?${params.toString()}`, { headers: authHeader() })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    const content = await res.text()
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href
    link.download = `analytics_${dataset}_${analyticsRange.value}_${analyticsGranularity.value}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(href)
  } catch (error: any) {
    analyticsError.value = error?.message || 'Export failed'
  } finally {
    analyticsExporting.value = null
  }
}

const loadAdminPills = async () => {
  if (!isAdmin.value) return
  const [pillsRes, keyRes] = await Promise.all([
    fetch(`${config.public.apiUrl}/api/admin/pills`, { headers: authHeader() }),
    fetch(`${config.public.apiUrl}/api/admin/pills/settings`, { headers: authHeader() }),
  ])
  if (pillsRes.ok) {
    const data = await pillsRes.json()
    adminPills.value = Array.isArray(data?.pills) ? data.pills : []
  }
  if (keyRes.ok) {
    pillsApiKeyMeta.value = await keyRes.json()
  }
}

function buildModeAwarePillPayload(input: {
  valueMode?: PillValueMode
  value: number
  valueSecondary?: any
  graphEmbedUrl?: any
  graphPayloadJson?: any
}) {
  const mode: PillValueMode = input.valueMode === 'percentage'
    || input.valueMode === 'agree_disagree'
    || input.valueMode === 'graph_embed'
    ? input.valueMode
    : 'number'
  const base = {
    valueMode: mode,
    value: Number(input.value),
    valueSecondary: null as number | null,
    graphEmbedUrl: null as string | null,
    graphPayloadJson: null as string | null,
  }
  if (mode === 'agree_disagree') {
    const secondary = input.valueSecondary === '' || input.valueSecondary == null ? null : Number(input.valueSecondary)
    return { ...base, valueSecondary: Number.isFinite(secondary as number) ? secondary : null }
  }
  if (mode === 'graph_embed') {
    return {
      ...base,
      graphEmbedUrl: typeof input.graphEmbedUrl === 'string' ? input.graphEmbedUrl.trim() || null : null,
      graphPayloadJson: typeof input.graphPayloadJson === 'string' ? input.graphPayloadJson.trim() || null : null,
    }
  }
  return base
}

const createPill = async () => {
  const modePayload = buildModeAwarePillPayload({
    valueMode: newPill.value.valueMode,
    value: Number(newPill.value.value),
    valueSecondary: newPill.value.valueSecondary,
    graphEmbedUrl: newPill.value.graphEmbedUrl,
    graphPayloadJson: newPill.value.graphPayloadJson,
  })
  const payload = {
    label: newPill.value.label.trim(),
    value: modePayload.value,
    valueMode: modePayload.valueMode,
    valueSecondary: modePayload.valueSecondary,
    graphEmbedUrl: modePayload.graphEmbedUrl,
    graphPayloadJson: modePayload.graphPayloadJson,
    color: newPill.value.color || '#2563eb',
    imageUrl: newPill.value.imageUrl?.trim() || null,
    sortOrder: adminPills.value.length,
  }
  if (!payload.label) return
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/pills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      await loadAdminPills()
      throw new Error(`Failed to create pill: HTTP ${res.status}`)
    }
    newPill.value = {
      label: '',
      value: 0,
      valueSecondary: '',
      valueMode: 'number',
      graphEmbedUrl: '',
      graphPayloadJson: '',
      color: '#2563eb',
      imageUrl: '',
    }
    await loadAdminPills()
  } catch (error) {
    console.error('createPill failed', error)
  }
}

const uploadPillImage = async (event: Event, pill: AdminPillRow | null) => {
  const target = event.target as HTMLInputElement | null
  const file = target?.files?.[0]
  if (!file) return
  try {
    const form = new FormData()
    form.set('image', file)
    const res = await fetch(`${config.public.apiUrl}/api/admin/pills/image-upload`, {
      method: 'POST',
      headers: authHeader(),
      body: form,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    const imageUrl = String(data.imageUrl || '')
    if (!imageUrl) return
    if (pill) pill.image_url = imageUrl
    else newPill.value.imageUrl = imageUrl
  } catch (error) {
    console.error('uploadPillImage failed', error)
  } finally {
    if (target) target.value = ''
  }
}

const savePill = async (pill: any) => {
  try {
    const modePayload = buildModeAwarePillPayload({
      valueMode: pill.value_mode || 'number',
      value: Number(pill.value),
      valueSecondary: pill.value_secondary,
      graphEmbedUrl: pill.graph_embed_url,
      graphPayloadJson: pill.graph_payload_json,
    })
    const res = await fetch(`${config.public.apiUrl}/api/admin/pills`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        id: pill.id,
        label: pill.label,
        value: modePayload.value,
        valueMode: modePayload.valueMode,
        valueSecondary: modePayload.valueSecondary,
        graphEmbedUrl: modePayload.graphEmbedUrl,
        graphPayloadJson: modePayload.graphPayloadJson,
        color: pill.color,
        imageUrl: typeof pill.image_url === 'string' ? pill.image_url : null,
        sortOrder: Number(pill.sort_order),
      }),
    })
    if (!res.ok) {
      await loadAdminPills()
      throw new Error(`Failed to save pill: HTTP ${res.status}`)
    }
  } catch (error) {
    console.error('savePill failed', error)
  }
}

const deletePill = async (id: string) => {
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/pills`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ id }),
    })
    if (!res.ok) {
      await loadAdminPills()
      throw new Error(`Failed to delete pill: HTTP ${res.status}`)
    }
    await loadAdminPills()
  } catch (error) {
    console.error('deletePill failed', error)
  }
}

const movePill = async (idx: number, direction: -1 | 1) => {
  const prev = [...adminPills.value]
  const next = [...adminPills.value]
  const swapIdx = idx + direction
  if (swapIdx < 0 || swapIdx >= next.length) return
  const moved = next.splice(idx, 1)[0]
  if (!moved) return
  next.splice(swapIdx, 0, moved)
  adminPills.value = next.map((pill, i) => ({ ...pill, sort_order: i }))
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/pills`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        items: adminPills.value.map((pill) => ({ id: pill.id })),
      }),
    })
    if (!res.ok) {
      adminPills.value = prev
      await loadAdminPills()
      throw new Error(`Failed to reorder pills: HTTP ${res.status}`)
    }
  } catch (error) {
    adminPills.value = prev
    await loadAdminPills()
    console.error('movePill failed', error)
  }
}

const savePillsApiKey = async () => {
  const key = pillsApiKey.value.trim()
  if (!key) return
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/pills/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ apiKey: key }),
    })
    if (!res.ok) {
      await loadAdminPills()
      throw new Error(`Failed to save pills API key: HTTP ${res.status}`)
    }
    pillsApiKey.value = ''
    await loadAdminPills()
  } catch (error) {
    console.error('savePillsApiKey failed', error)
  }
}

const saveNewsletterSettings = async () => {
  if (!isAdmin.value) return
  newsletterSaving.value = true
  newsletterMessage.value = ''
  try {
    const raw = newsletterListId.value.trim()
    let brevoSubscriberListId: number | '' = ''
    if (raw) {
      if (!/^\d+$/.test(raw)) {
        throw new Error('Subscriber list ID must be a positive integer or empty')
      }
      const n = Number.parseInt(raw, 10)
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error('Subscriber list ID must be a positive integer or empty')
      }
      brevoSubscriberListId = n
    }
    const res = await fetch(`${config.public.apiUrl}/api/admin/newsletter/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        brevoSubscriberListId,
        brevoCampaignSenderEmail: newsletterSenderEmail.value.trim(),
        brevoCampaignSenderName: newsletterSenderName.value.trim(),
        brevoNewsletterPollIntervalMs: newsletterPollIntervalMs.value,
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    newsletterMessage.value = 'Newsletter settings saved.'
    newsletterMessageClass.value = 'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200'
    await loadNewsletterSettings()
  } catch (e: any) {
    newsletterMessage.value = e.message || 'Failed to save settings'
    newsletterMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    newsletterSaving.value = false
  }
}

const sendNewsletterCampaign = async () => {
  if (!isAdmin.value) return
  newsletterSending.value = true
  newsletterMessage.value = ''
  try {
    if (!newsletterSendDedupeKey.value) {
      newsletterSendDedupeKey.value = crypto.randomUUID()
    }
    const res = await fetch(`${config.public.apiUrl}/api/admin/newsletter/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        subject: newsletterSubject.value.trim(),
        htmlBody: newsletterHtml.value,
        templateId: newsletterTemplateId.value || undefined,
        dedupeKey: newsletterSendDedupeKey.value,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const base = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
      const code = typeof data.code === 'string' ? ` (${data.code})` : ''
      const brevo = data.brevoStatus != null ? ` · Brevo ${data.brevoStatus}` : ''
      throw new Error(`${base}${code}${brevo}`)
    }
    newsletterSendDedupeKey.value = null
    newsletterMessage.value = data.idempotent
      ? `Already sent (Brevo campaign id ${data.campaignId}).`
      : (data.campaignId != null
        ? `Campaign scheduled (Brevo campaign id ${data.campaignId}).`
        : 'Campaign sent.')
    newsletterMessageClass.value = 'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200'
  } catch (e: any) {
    newsletterMessage.value = e.message || 'Send failed'
    newsletterMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    newsletterSending.value = false
  }
}

const saveAll = async () => {
  saving.value      = true
  saveMessage.value = ''
  try {
    const featuredVideoIds = featuredSlots.value.map(v => v?.id).filter(Boolean)
    const [homepageRes, locksRes] = await Promise.all([
      fetch(`${config.public.apiUrl}/api/admin/homepage/content`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          homepageConfig: {
            featuredVideoIds,
            layoutBlocks: layoutBlocks.value.map((block) => sanitizeBlockForSave(block)),
          },
          categoryOrder: categories.value.map((category) => ({
            id: category.id,
            sortOrder: category.sort_order,
          })),
        }),
      }),
      fetch(`${config.public.apiUrl}/api/admin/preview-locks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          locks: Object.entries(previewLockByVideoId.value).map(([videoId, previewDuration]) => ({ videoId, previewDuration })),
        }),
      }),
    ])
    if (!homepageRes.ok) {
      const err = await homepageRes.json().catch(() => ({ error: `HTTP ${homepageRes.status}` }))
      throw new Error(err.error || `Homepage save failed (HTTP ${homepageRes.status})`)
    }
    if (!locksRes.ok) {
      const err = await locksRes.json().catch(() => ({ error: `HTTP ${locksRes.status}` }))
      throw new Error(err.error || `Preview locks save failed (HTTP ${locksRes.status})`)
    }
    const locksData = await locksRes.json().catch(() => ({}))
    const notify = locksData?.podcastPreviewNotify
    let notifyNote = ''
    if (notify?.delivered) {
      notifyNote = ` Media host notified to re-render ${notify.eligibleCount ?? notify.acceptedCount ?? 0} preview MP3(s).`
    } else if (notify?.code === 'nothing_to_rebuild') {
      notifyNote = ' No trimmed preview MP3s needed (premium-only or unlock full).'
    } else if (notify?.code === 'webhook_not_configured' || notify?.code === 'secret_not_configured') {
      notifyNote = ' Configure the podcast rebuild webhook in System to auto-refresh preview MP3s after save.'
    } else if (notify?.code === 'free_preview_disabled') {
      notifyNote = ''
    } else if (notify && !notify.delivered && notify.code) {
      notifyNote = ` Preview MP3 host notify did not complete (${notify.code}).`
    }
    saveMessage.value      = `Changes saved to API database settings and preview lock durations.${notifyNote}`
    saveMessageClass.value = 'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200'
    await reloadAll()
  } catch (e: any) {
    saveMessage.value      = e.message || 'Failed to save changes'
    saveMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    saving.value = false
  }
}

watch(
  layoutBlocks,
  (blocks) => {
    for (const block of blocks) {
      if (block.type !== 'category' && typeof block.categoryId === 'string' && block.categoryId) {
        block.categoryId = null
      }
      if (block.type !== 'category' && block.rightRailWithNextSideMini) {
        block.rightRailWithNextSideMini = false
      }
      if (block.type === 'split_horizontal' || block.type === 'split_vertical') {
        const children = Array.isArray(block.childBlocks) ? block.childBlocks : []
        for (const child of children) {
          if (child.type !== 'category' && typeof child.categoryId === 'string' && child.categoryId) {
            child.categoryId = null
          }
        }
      }
    }
  },
  { deep: true },
)

const reloadAll = async () => {
  loading.value = true
  try {
    await loadVideos()
    await loadMediaConvertConfig()
    await loadCategories()
    await loadHomepageState()
    await loadHomepagePlacement()
    await loadNewsletterSettings()
    await loadNewsletterTemplates()
    await loadSystemFeatures()
    await loadReplicationStatus({ probe: true })
    await loadMediaConvertSystemSettings()
    await loadPaymentSettings()
    if (systemFeatures.value.promotionsEnabled) await loadPromotions()
    if (systemFeatures.value.isicEnabled) await loadIsicCampaigns()
    await loadSiteBranding()
    if (systemFeatures.value.freePodcastPreviewEnabled) await loadRssPodcastWebhookSettings()
    await loadUsers()
    await loadAnalytics()
    await loadAdminPills()
  }
  finally { loading.value = false }
}

function statusBadgeClass(status: string | null) {
  if (status === 'published') return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
  if (status === 'archived')  return 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
  return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' // draft
}

function formatSeconds(total: number): string {
  if (!total || !Number.isFinite(total)) return '--'
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = Math.floor(total % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

async function startTitleEdit(video: Video) {
  editingTitle.value = { id: video.id, value: video.title }
  await nextTick()
  titleInputEl.value?.focus()
  titleInputEl.value?.select()
}

async function saveTitleEdit(video: Video) {
  const editing = editingTitle.value
  if (!editing || editing.id !== video.id) return
  const newTitle = editing.value.trim()
  editingTitle.value = null
  if (!newTitle || newTitle === video.title) return
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/videos/${video.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ title: newTitle }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    const idx = uploads.value.findIndex(v => v.id === video.id)
    if (idx !== -1) {
      const cur = uploads.value[idx]!
      uploads.value[idx] = { ...cur, title: newTitle }
    }
    // Keep the featured grid in sync so header cards show the new title immediately
    featuredSlots.value = featuredSlots.value.map(slot =>
      slot?.id === video.id ? { ...slot, title: newTitle } : slot
    )
  } catch (e: any) {
    saveMessage.value = `Failed to rename: ${e.message}`
    saveMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  }
}

async function updateVideoStatus(
  video: Video,
  newStatus: 'draft' | 'published' | 'archived',
  scheduledPublishAt: string | null = null,
  publishedAt: string | null = null,
) {
  statusUpdating.value[video.id] = true
  try {
    const payload: Record<string, unknown> = { status: newStatus }
    if (scheduledPublishAt !== null) payload.scheduledPublishAt = scheduledPublishAt
    if (publishedAt !== null) payload.publishedAt = publishedAt
    const res = await fetch(`${config.public.apiUrl}/api/admin/videos/${video.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    const { video: updated } = await res.json()
    const idx = uploads.value.findIndex(v => v.id === video.id)
    if (idx !== -1) {
      const cur = uploads.value[idx]!
      uploads.value[idx] = { ...cur, ...updated }
    }
    const publishedAtChanged = publishedAt !== null
    let statusToast = `Status updated: ${video.title} → ${newStatus}.`
    if (publishedAtChanged) {
      statusToast = `Published timestamp updated for ${video.title}.`
    } else if (scheduledPublishAt !== null && scheduledPublishAt !== '') {
      statusToast = updated.scheduled_publish_at
        ? `Publish scheduled for ${video.title}.`
        : `Display date (upload) updated for ${video.title}.`
    }
    showToast('success', statusToast)
  } catch (e: any) {
    saveMessage.value = `Failed to update "${video.title}": ${e.message}`
    showToast('error', `Failed to update ${video.title}: ${e.message}`)
    saveMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    statusUpdating.value[video.id] = false
  }
}

function parseAdminDateTimeToIso(raw: string): string | null {
  if (!raw?.trim()) return null
  const trimmed = raw.trim()
  const euro = parseEuropeanDateTimeToIso(trimmed)
  if (euro) return euro
  const strictIso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:Z|[+-]\d{2}:\d{2})$/
  const match = trimmed.match(strictIso)
  if (!match) return null
  const [, yText, moText, dText, hText, miText, sText = '0', msText = '0'] = match
  const y = Number(yText)
  const mo = Number(moText)
  const d = Number(dText)
  const h = Number(hText)
  const mi = Number(miText)
  const s = Number(sText)
  const ms = Number(msText.padEnd(3, '0'))
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d) || !Number.isFinite(h) || !Number.isFinite(mi) || !Number.isFinite(s) || !Number.isFinite(ms)) return null
  if (mo < 1 || mo > 12) return null
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  if (d < 1 || d > daysInMonth) return null
  if (h < 0 || h > 23 || mi < 0 || mi > 59 || s < 0 || s > 59 || ms < 0 || ms > 999) return null
  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

async function patchVideoUploadDate(video: Video, iso: string) {
  statusUpdating.value[video.id] = true
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/videos/${video.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ uploadDate: iso }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    const { video: updated } = await res.json()
    const idx = uploads.value.findIndex(v => v.id === video.id)
    if (idx !== -1) {
      const cur = uploads.value[idx]!
      uploads.value[idx] = { ...cur, ...updated }
    }
    uploadDateEditDraft.value = {
      ...uploadDateEditDraft.value,
      [video.id]: formatEuropeanDateTimeFromAny(updated.upload_date),
    }
    showToast('success', `Upload date updated for ${video.title}.`)
  } catch (e: any) {
    showToast('error', `Failed to update upload date: ${e.message}`)
  } finally {
    statusUpdating.value[video.id] = false
  }
}

async function applyUploadDateFromScheduleModal(video: Video) {
  const raw = scheduleModal.value.uploadDate.trim()
  const iso = parseAdminDateTimeToIso(raw)
  if (!iso) {
    showToast('error', `Use ${scheduleInputPlaceholder} (24-hour).`)
    return
  }
  setUploadDateDraft(video.id, raw)
  await patchVideoUploadDate(video, iso)
}

async function applyScheduleFromModal(video: Video) {
  const raw = scheduleModal.value.scheduleDate
  const trimmed = raw.trim()
  if (!trimmed) {
    await updateVideoStatus(video, 'draft', '')
    scheduleModal.value.scheduleDate = ''
    clearScheduleTextDraft(video.id)
    return
  }
  const iso = parseAdminDateTimeToIso(trimmed)
  if (!iso) {
    showToast('error', `Use ${scheduleInputPlaceholder} (24-hour).`)
    return
  }
  setScheduleDraft(video.id, trimmed)
  await updateVideoStatus(video, 'draft', iso)
  scheduleModal.value.scheduleDate = formatEuropeanDateTimeFromAny(iso)
  clearScheduleTextDraft(video.id)
}

async function clearScheduleFromModal(video: Video) {
  await updateVideoStatus(video, 'draft', '')
  const latest = uploads.value.find(v => v.id === video.id)
  if (!latest?.scheduled_publish_at) {
    scheduleModal.value.scheduleDate = ''
    clearScheduleTextDraft(video.id)
  }
}

async function applyPublishedAtFromModal(video: Video) {
  const raw = scheduleModal.value.publishedDate
  const trimmed = raw.trim()
  if (!trimmed) {
    await updateVideoPublishedAt(video, '')
    scheduleModal.value.publishedDate = ''
    clearPublishedTextDraft(video.id)
    return
  }
  const iso = parseAdminDateTimeToIso(trimmed)
  if (!iso) {
    showToast('error', `Use ${scheduleInputPlaceholder} (24-hour).`)
    return
  }
  setPublishedDraft(video.id, trimmed)
  await updateVideoPublishedAt(video, iso)
  scheduleModal.value.publishedDate = formatEuropeanDateTimeFromAny(iso)
  clearPublishedTextDraft(video.id)
}

async function clearPublishedDateFromModal(video: Video) {
  await updateVideoPublishedAt(video, '')
  const latest = uploads.value.find(v => v.id === video.id)
  if (!latest?.published_at) {
    scheduleModal.value.publishedDate = ''
    clearPublishedTextDraft(video.id)
  }
}

async function updateVideoPublishedAt(video: Video, rawValue: string) {
  statusUpdating.value[video.id] = true
  try {
    const nextIso = rawValue ? parseAdminDateTimeToIso(rawValue) : null
    if (rawValue && !nextIso) {
      throw new Error(`Invalid date — use ${scheduleInputPlaceholder} (24-hour).`)
    }
    const res = await fetch(`${config.public.apiUrl}/api/admin/videos/${video.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ publishedAt: nextIso }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    const { video: updated } = await res.json()
    const idx = uploads.value.findIndex(v => v.id === video.id)
    if (idx !== -1) {
      const cur = uploads.value[idx]!
      uploads.value[idx] = { ...cur, ...updated }
    }
    showToast('success', `Published date updated for ${video.title}.`)
  } catch (e: any) {
    showToast('error', `Failed to update published date: ${e.message}`)
  } finally {
    statusUpdating.value[video.id] = false
  }
}

async function sendNotification(video: Video) {
  notifying.value[video.id] = true
  pushCampaignFunnel.value = null
  pushCampaignFunnelError.value = null
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/videos/${video.id}/notify`, {
      method: 'POST',
      headers: authHeader(),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`)
    }
    const idx = uploads.value.findIndex((v) => v.id === video.id)
    if (idx !== -1) {
      uploads.value[idx] = { ...uploads.value[idx]!, notified_at: new Date().toISOString() }
    }
    showToast('success', `Notification queued for ${video.title}.`)
    if (typeof data.campaignId === 'string') {
      await loadPushCampaignFunnel(data.campaignId, video.title)
    }
  } catch (e: any) {
    saveMessage.value = `Failed to send notification for "${video.title}": ${e.message}`
    showToast('error', `Failed to notify ${video.title}: ${e.message}`)
    saveMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    notifying.value[video.id] = false
  }
}

async function loadPushCampaignFunnel(campaignId: string, videoTitle: string) {
  pushCampaignFunnelError.value = null
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/push-analytics?campaignId=${encodeURIComponent(campaignId)}`, {
      headers: authHeader(),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const detail = typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`
      pushCampaignFunnelError.value = `Failed to load campaign funnel: ${detail}`
      showToast('error', pushCampaignFunnelError.value)
      return
    }
    pushCampaignFunnel.value = {
      campaignId,
      videoTitle,
      sent: Number(data?.funnel?.sent || 0),
      clicks: Number(data?.funnel?.clicks || 0),
      clickRatePercent: Number(data?.funnel?.clickRatePercent || 0),
      medianClickLatencySeconds: data?.funnel?.medianClickLatencySeconds ?? null,
      watchSessions: Number(data?.funnel?.watchSessions || 0),
      watchRatePercent: Number(data?.funnel?.watchRatePercent || 0),
      completionRatePercent: Number(data?.funnel?.completionRatePercent || 0),
      avgSessionDepth: Number(data?.funnel?.avgSessionDepth || 0),
    }
  } catch (e: any) {
    pushCampaignFunnelError.value = `Failed to load campaign funnel: ${e?.message || 'Unknown error'}`
    showToast('error', pushCampaignFunnelError.value)
  }
}

const importUsersFromCsv = async () => {
  const csv = usersImportCsv.value.trim()
  const mailingListId = usersImportMailingListId.value.trim()
  if (!csv) {
    showToast('error', 'CSV payload is required.')
    return
  }
  if (!mailingListId) {
    showToast('error', 'Relink mailing list ID is required.')
    return
  }
  usersImporting.value = true
  usersImportResult.value = null
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/users/import-csv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ csv, mailingListId }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    usersImportResult.value = {
      imported: Number(data.imported || 0),
      existing: Number(data.existing || 0),
      totalEmails: Number(data.totalEmails || 0),
      mailingListId: String(data.mailingListId || mailingListId),
    }
    showToast('success', 'CSV users imported successfully.')
    await loadUsers()
  } catch (e: any) {
    showToast('error', `CSV import failed: ${e.message}`)
  } finally {
    usersImporting.value = false
  }
}

async function trashVideo(video: Video) {
  trashing.value[video.id] = true
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/videos/${video.id}`, {
      method: 'DELETE',
      headers: authHeader(),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    uploads.value = uploads.value.filter(v => v.id !== video.id)
    featuredSlots.value = featuredSlots.value.map(slot =>
      slot?.id === video.id ? null : slot
    )
    saveMessage.value = `"${video.title}" has been permanently deleted.`
    showToast('success', `${video.title} deleted.`)
    saveMessageClass.value = 'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200'
  } catch (e: any) {
    saveMessage.value = `Failed to delete "${video.title}": ${e.message}`
    saveMessageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    trashing.value[video.id] = false
  }
}



async function handleThumbnailSelect(event: Event, video: Video) {
  const input = event.target as HTMLInputElement
  const file  = input.files?.[0]
  if (!file) return

  // 10 MB client-side guard (the API also enforces this).
  if (file.size > 10 * 1024 * 1024) {
    alert('Image must be under 10 MB')
    input.value = ''
    return
  }

  uploadingFor.value = video.id
  try {
    const formData = new FormData()
    formData.append('thumbnail', file)

    // Do NOT set Content-Type manually — the browser sets it with the correct
    // multipart boundary when FormData is the body.
    const res = await fetch(
      `${config.public.apiUrl}/api/admin/videos/${video.id}/thumbnail`,
      { method: 'POST', headers: { ...authHeader() }, body: formData },
    )
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }))
      throw new Error(err.error || 'Upload failed')
    }
    const data = await res.json()
    // Update the local record so the UI reflects the new thumbnail without a full reload.
    // The API returns a versioned URL (?v=...) to force cache eviction across devices.
    if (data?.thumbnails?.large) {
      const cacheBustedUrl = String(data.thumbnails.large)
      const idx = uploads.value.findIndex(v => v.id === video.id)
      if (idx !== -1) {
        const cur = uploads.value[idx]!
        uploads.value[idx] = { ...cur, thumbnail_url: cacheBustedUrl }
      }
      featuredSlots.value = featuredSlots.value.map(slot =>
        slot?.id === video.id ? { ...slot, thumbnail_url: cacheBustedUrl } : slot
      )
      showToast('success', `Thumbnail updated for ${video.title}. Cache refreshed.`)
    } else {
      // If the API response is missing a thumbnail URL, keep the existing thumbnail as-is.
      showToast('error', 'Thumbnail upload succeeded but API did not return a thumbnail URL.')
    }
  } catch (err: any) {
    showToast('error', `Thumbnail upload failed: ${err.message}`)
  } finally {
    uploadingFor.value = null
    input.value = '' // reset so the same file can be re-selected
  }
}

type Toast = { id: number; type: 'success' | 'error'; message: string }
const toasts = ref<Toast[]>([])
let toastId = 0
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>()
function showToast(type: Toast['type'], message: string) {
  const id = ++toastId
  toasts.value.push({ id, type, message })
  const timer = setTimeout(() => {
    toasts.value = toasts.value.filter(t => t.id !== id)
    toastTimers.delete(id)
  }, 3200)
  toastTimers.set(id, timer)
}

type ConfirmModalState =
  | { open: false }
  | {
      open: true
      mode: 'video'
      action: 'trash' | 'revert_to_draft'
      video: Video
      impactText: string
    }
  | {
      open: true
      mode: 'user_role' | 'user_subscription'
      userId: string
      email: string
      prevRole: string
      nextRole: string
      prevSubscription: string
      nextSubscription: string
      impactText: string
    }

const confirmModal = ref<ConfirmModalState>({ open: false })

const confirmModalTitle = computed(() => {
  const m = confirmModal.value
  if (!m.open) return ''
  if (m.mode === 'video') return m.action === 'trash' ? 'Permanently delete video?' : 'Revert video to draft?'
  if (m.mode === 'user_role') return 'Confirm role change'
  return 'Confirm subscription change'
})

const confirmModalConfirmClass = computed(() => {
  const m = confirmModal.value
  if (!m.open || m.mode === 'video') {
    return m.open && m.mode === 'video' && m.action === 'trash'
      ? 'bg-red-600 hover:bg-red-700'
      : 'bg-amber-600 hover:bg-amber-700'
  }
  return 'bg-purple-600 hover:bg-purple-700'
})

function closeConfirmModal() {
  confirmModal.value = { open: false }
}

/** Cancel user confirm: revert optimistic select; resync list from server. */
function onConfirmCancel() {
  const was = confirmModal.value
  if (was.open && (was.mode === 'user_role' || was.mode === 'user_subscription')) {
    patchUserRowById(was.userId, { uiRole: undefined, uiSubscription: undefined })
  }
  closeConfirmModal()
  if (was.open && (was.mode === 'user_role' || was.mode === 'user_subscription') && activeAdminTab.value === 'users') {
    void loadUsers()
  }
}

function openConfirmModal(video: Video, action: 'trash' | 'revert_to_draft'): void
function openConfirmModal(payload: {
  mode: 'user_role' | 'user_subscription'
  userId: string
  email: string
  prevRole: string
  nextRole: string
  prevSubscription: string
  nextSubscription: string
  impactText: string
}): void
function openConfirmModal(
  videoOrPayload: Video | {
    mode: 'user_role' | 'user_subscription'
    userId: string
    email: string
    prevRole: string
    nextRole: string
    prevSubscription: string
    nextSubscription: string
    impactText: string
  },
  action?: 'trash' | 'revert_to_draft',
) {
  if (videoOrPayload && typeof videoOrPayload === 'object' && 'mode' in videoOrPayload) {
    const p = videoOrPayload
    confirmModal.value = {
      open: true,
      mode: p.mode,
      userId: p.userId,
      email: p.email,
      prevRole: p.prevRole,
      nextRole: p.nextRole,
      prevSubscription: p.prevSubscription,
      nextSubscription: p.nextSubscription,
      impactText: p.impactText,
    }
    return
  }
  const video = videoOrPayload as Video
  const act = action!
  confirmModal.value = {
    open: true,
    mode: 'video',
    action: act,
    video,
    impactText: act === 'trash'
      ? `This permanently removes ${video.title} from the database and deletes all files in R2 (videos/${video.id}/). This cannot be undone.`
      : `This will move ${video.title} back to draft status and remove it from published surfaces.`,
  }
}

async function runConfirmedAction() {
  const current = confirmModal.value
  if (!current.open) return
  if (current.mode === 'video') {
    closeConfirmModal()
    if (current.action === 'trash') {
      await trashVideo(current.video)
    } else {
      await updateVideoStatus(current.video, 'draft', null)
    }
    return
  }
  const snap = { ...current }
  closeConfirmModal()
  const patch: Record<string, string> =
    snap.mode === 'user_role'
      ? { role: snap.nextRole }
      : { subscriptionStatus: snap.nextSubscription }
  const ok = await updateUser(snap.userId, patch)
  if (!ok) {
    patchUserRowById(snap.userId, { uiRole: undefined, uiSubscription: undefined })
    if (activeAdminTab.value === 'users') void loadUsers()
  }
}

async function startSlugEdit(video: Video) {
  editingSlug.value = { id: video.id, value: video.slug ?? '' }
  await nextTick()
  slugInputEl.value?.focus()
  slugInputEl.value?.select()
}

async function saveSlugEdit(video: Video) {
  const editing = editingSlug.value
  if (!editing || editing.id !== video.id) return
  const slugInput = editing.value.trim()
  const requestedSlug = slugInput ? slugInput.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '') : null
  editingSlug.value = null
  if (requestedSlug === (video.slug ?? null)) return
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/videos/${video.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ slug: requestedSlug }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    const data = await res.json().catch(() => ({}))
    const normalizedSlug = data?.video?.slug ?? requestedSlug
    const idx = uploads.value.findIndex(v => v.id === video.id)
    if (idx !== -1) {
      const cur = uploads.value[idx]!
      uploads.value[idx] = { ...cur, slug: normalizedSlug }
    }
    showToast('success', normalizedSlug ? `Slug set: /watch/${normalizedSlug}` : 'Slug cleared.')
  } catch (e: any) {
    showToast('error', `Failed to update slug: ${e.message}`)
  }
}

async function startLegacySlugEdit(video: Video) {
  editingLegacySlug.value = { id: video.id, value: video.legacy_slug ?? '' }
  await nextTick()
  legacySlugInputEl.value?.focus()
  legacySlugInputEl.value?.select()
}

async function saveLegacySlugEdit(video: Video) {
  const editing = editingLegacySlug.value
  if (!editing || editing.id !== video.id) return
  const legacyInput = editing.value.trim()
  const requestedLegacySlug = legacyInput
    ? legacyInput.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '')
    : null
  editingLegacySlug.value = null
  if (requestedLegacySlug === (video.legacy_slug ?? null)) return
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/videos/${video.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ legacySlug: requestedLegacySlug }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    const data = await res.json().catch(() => ({}))
    const normalizedLegacySlug = data?.video?.legacy_slug ?? requestedLegacySlug
    const idx = uploads.value.findIndex(v => v.id === video.id)
    if (idx !== -1) {
      const cur = uploads.value[idx]!
      uploads.value[idx] = { ...cur, legacy_slug: normalizedLegacySlug }
    }
    showToast('success', normalizedLegacySlug ? `Legacy redirect set: /videos/${normalizedLegacySlug} -> /watch` : 'Legacy redirect cleared.')
  } catch (e: any) {
    showToast('error', `Failed to update legacy slug: ${e.message}`)
  }
}

function openDescriptionModal(video: Video) {
  descriptionModal.value = {
    open: true,
    videoId: video.id,
    title: video.title,
    value: video.description || '',
  }
}

function closeDescriptionModal() {
  descriptionModal.value = {
    open: false,
    videoId: null,
    title: '',
    value: '',
  }
}

async function saveDescriptionModal() {
  const videoId = descriptionModal.value.videoId
  if (!videoId) return
  const video = uploads.value.find((v) => v.id === videoId)
  if (!video) return
  const newDesc = descriptionModal.value.value.trim()
  if (newDesc === (video.description || '')) {
    closeDescriptionModal()
    return
  }
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/videos/${videoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ description: newDesc }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    const idx = uploads.value.findIndex(v => v.id === videoId)
    if (idx !== -1) {
      const cur = uploads.value[idx]!
      uploads.value[idx] = { ...cur, description: newDesc }
    }
    closeDescriptionModal()
    showToast('success', 'Description updated.')
  } catch (e: any) {
    showToast('error', `Failed to update description: ${e.message}`)
  }
}

function openSwapModal(video: Video) {
  swapModal.value = { open: true, step: 0, sourceVideo: video, targetId: null }
}

function selectSwapTarget(draft: Video) {
  swapModal.value.targetId = draft.id
  swapModal.value.step = 1
}

async function executeSwap() {
  if (!swapModal.value.sourceVideo || !swapModal.value.targetId) return
  swapModal.value.step = 2
  try {
    const res = await fetch(
      `${config.public.apiUrl}/api/admin/videos/${swapModal.value.sourceVideo.id}/swap`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ swapWithId: swapModal.value.targetId }),
      }
    )
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    swapModal.value.open = false
    showToast('success', 'Swap complete — video list updated.')
    await reloadAll()
  } catch (e: any) {
    showToast('error', `Swap failed: ${e.message}`)
    swapModal.value.step = 1
  }
}

const confirmDialogRef = ref<HTMLElement | null>(null)
const swapDialogRef    = ref<HTMLElement | null>(null)
const scheduleDialogRef = ref<HTMLElement | null>(null)
const descriptionDialogRef = ref<HTMLElement | null>(null)
const transferSubDialogRef = ref<HTMLElement | null>(null)
const lastFocusedEl    = ref<HTMLElement | null>(null)

function setAdminTab(tab: 'videos' | 'categories' | 'homepage' | 'pills' | 'notifications' | 'newsletter' | 'users' | 'analytics' | 'system') {
  router.replace({ query: { ...route.query, tab } })
}

function onConfirmModalKeydown(e: KeyboardEvent) {
  if (!confirmModal.value.open) return
  if (e.key === 'Escape') {
    e.preventDefault()
    const m = confirmModal.value
    if (m.open && (m.mode === 'user_role' || m.mode === 'user_subscription')) onConfirmCancel()
    else closeConfirmModal()
    return
  }
  if (e.key !== 'Tab' || !confirmDialogRef.value) return
  const focusable = confirmDialogRef.value.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )
  if (!focusable.length) return
  const first = focusable[0]!
  const last = focusable[focusable.length - 1]!
  const active = document.activeElement as HTMLElement | null
  if (e.shiftKey && active === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}

watch(() => route.query, (query) => {
  const requested = typeof query.tab === 'string' ? query.tab : ''
  const allowed = new Set(adminTabs.value.map((t) => t.id))
  activeAdminTab.value = requested && allowed.has(requested as any) ? (requested as any) : 'videos'
}, { immediate: true })

watch(() => confirmModal.value.open, async (open) => {
  if (open) {
    lastFocusedEl.value = document.activeElement as HTMLElement | null
    await nextTick()
    confirmDialogRef.value?.focus()
    window.addEventListener('keydown', onConfirmModalKeydown)
  } else {
    window.removeEventListener('keydown', onConfirmModalKeydown)
    lastFocusedEl.value?.focus()
  }
})

function onSwapModalKeydown(e: KeyboardEvent) {
  if (!swapModal.value.open) return
  if (e.key === 'Escape') {
    e.preventDefault()
    swapModal.value.open = false
    return
  }
  if (e.key !== 'Tab' || !swapDialogRef.value) return
  const focusable = swapDialogRef.value.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )
  if (!focusable.length) return
  const first = focusable[0]!
  const last = focusable[focusable.length - 1]!
  const active = document.activeElement as HTMLElement | null
  if (e.shiftKey && active === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}

function onScheduleModalKeydown(e: KeyboardEvent) {
  if (!scheduleModal.value.open) return
  if (e.key === 'Escape') {
    e.preventDefault()
    closeScheduleModal()
    return
  }
  if (e.key !== 'Tab' || !scheduleDialogRef.value) return
  const focusable = scheduleDialogRef.value.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )
  if (!focusable.length) return
  const first = focusable[0]!
  const last = focusable[focusable.length - 1]!
  const active = document.activeElement as HTMLElement | null
  if (e.shiftKey && active === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}

function onDescriptionModalKeydown(e: KeyboardEvent) {
  if (!descriptionModal.value.open) return
  if (e.key === 'Escape') {
    e.preventDefault()
    closeDescriptionModal()
    return
  }
  if (e.key !== 'Tab' || !descriptionDialogRef.value) return
  const focusable = descriptionDialogRef.value.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )
  if (!focusable.length) return
  const first = focusable[0]!
  const last = focusable[focusable.length - 1]!
  const active = document.activeElement as HTMLElement | null
  if (e.shiftKey && active === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}

function onTransferSubModalKeydown(e: KeyboardEvent) {
  if (!transferSubModal.value.open) return
  if (e.key === 'Escape') {
    e.preventDefault()
    closeTransferSubscriptionModal()
    return
  }
  if (e.key !== 'Tab' || !transferSubDialogRef.value) return
  const focusable = transferSubDialogRef.value.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )
  if (!focusable.length) return
  const first = focusable[0]!
  const last = focusable[focusable.length - 1]!
  const active = document.activeElement as HTMLElement | null
  const activeIsOutside = !active || !transferSubDialogRef.value.contains(active)
  if (activeIsOutside) {
    e.preventDefault()
    if (e.shiftKey) {
      last.focus()
    } else {
      first.focus()
    }
  } else if (e.shiftKey && active === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}

watch(() => swapModal.value.open, async (open) => {
  if (open) {
    lastFocusedEl.value = document.activeElement as HTMLElement | null
    await nextTick()
    swapDialogRef.value?.focus()
    window.addEventListener('keydown', onSwapModalKeydown)
  } else {
    window.removeEventListener('keydown', onSwapModalKeydown)
    lastFocusedEl.value?.focus()
  }
})

watch(() => scheduleModal.value.open, async (open) => {
  if (open) {
    lastFocusedEl.value = document.activeElement as HTMLElement | null
    await nextTick()
    scheduleDialogRef.value?.focus()
    window.addEventListener('keydown', onScheduleModalKeydown)
  } else {
    window.removeEventListener('keydown', onScheduleModalKeydown)
    lastFocusedEl.value?.focus()
  }
})

watch(() => descriptionModal.value.open, async (open) => {
  if (open) {
    lastFocusedEl.value = document.activeElement as HTMLElement | null
    await nextTick()
    descriptionDialogRef.value?.focus()
    descriptionInputEl.value?.focus()
    window.addEventListener('keydown', onDescriptionModalKeydown)
  } else {
    window.removeEventListener('keydown', onDescriptionModalKeydown)
    lastFocusedEl.value?.focus()
  }
})

watch(() => transferSubModal.value.open, async (open) => {
  if (open) {
    lastFocusedEl.value = document.activeElement as HTMLElement | null
    await nextTick()
    const emailInput = document.getElementById('transfer-sub-target-email') as HTMLInputElement | null
    emailInput?.focus()
    window.addEventListener('keydown', onTransferSubModalKeydown)
  } else {
    window.removeEventListener('keydown', onTransferSubModalKeydown)
    lastFocusedEl.value?.focus()
  }
})

onMounted(async () => {
  await reloadAll()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onConfirmModalKeydown)
  window.removeEventListener('keydown', onSwapModalKeydown)
  window.removeEventListener('keydown', onScheduleModalKeydown)
  window.removeEventListener('keydown', onDescriptionModalKeydown)
  window.removeEventListener('keydown', onTransferSubModalKeydown)
  if (usersSearchDebounceTimer) clearTimeout(usersSearchDebounceTimer)
  for (const timer of toastTimers.values()) clearTimeout(timer)
  toastTimers.clear()
})
</script>