(() => {
  const config = window.PORTFOLIO_CONFIG || {};
  const setupPanel = document.querySelector('#setup-panel');
  const loginPanel = document.querySelector('#login-panel');
  const app = document.querySelector('#app');
  const loginForm = document.querySelector('#login-form');
  const loginMessage = document.querySelector('#login-message');
  const postForm = document.querySelector('#post-form');
  const postList = document.querySelector('#post-list');
  const formMessage = document.querySelector('#form-message');
  const statusMessage = document.querySelector('#status');
  const formHeading = document.querySelector('#form-heading');
  const publishedInput = document.querySelector('#published');
  const savePostButton = document.querySelector('#save-post');
  const mediaManager = document.querySelector('#media-manager');
  const mediaForm = document.querySelector('#media-form');
  const mediaList = document.querySelector('#media-list');
  const mediaMessage = document.querySelector('#media-message');
  let editingId = null;
  let supabase;
  let editingMediaId = null;

  const portfolioLink = document.querySelector('.topbar a');
  if (portfolioLink && config.publicSiteUrl) portfolioLink.href = config.publicSiteUrl;

  const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));

  const show = (element) => element.classList.remove('hidden');
  const hide = (element) => element.classList.add('hidden');
  const message = (element, text) => { element.textContent = text; };
  const explainError = (error) => error?.message === 'Bucket not found'
    ? 'Storage bucket "portfolio-images" is missing. Run the bucket setup SQL in Supabase, then try again.'
    : error?.message || 'Something went wrong. Please try again.';

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    show(setupPanel);
    return;
  }

  supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

  const getPosts = async () => {
    const { data, error } = await supabase.from('posts').select('*').order('date', { ascending: false });
    if (error) throw error;
    return data || [];
  };

  const getMedia = async () => {
    const { data, error } = await supabase.from('media_assets').select('*').order('sort_order').order('number');
    if (error) throw error;
    return data || [];
  };

  const resetMediaForm = () => {
    mediaForm.reset();
    document.querySelector('#media-id').value = '';
    document.querySelector('#media-visible').checked = true;
    editingMediaId = null;
    message(mediaMessage, '');
  };

  const renderMedia = async () => {
    try {
      const media = await getMedia();
      mediaList.innerHTML = media.length ? media.map((item) => `
        <article class="post">
          <div><span class="meta">${escapeHtml(item.group_id)} · ${escapeHtml(item.media_type)} · ${item.visible ? 'Visible' : 'Hidden'}</span><h3>${escapeHtml(item.number)} — ${escapeHtml(item.title)}</h3></div>
          <div class="post-actions"><button class="secondary" data-media-edit="${item.id}" type="button">Edit</button><button class="danger" data-media-hide="${item.id}" type="button">${item.visible ? 'Hide' : 'Show'}</button></div>
          <p>${escapeHtml(item.caption)}</p>
        </article>
      `).join('') : '<article class="post"><h3>No managed media yet</h3><p>Run the media library seed SQL to import the existing archive.</p></article>';
    } catch (error) {
      message(mediaMessage, explainError(error));
    }
  };

  const renderPosts = async () => {
    try {
      const posts = await getPosts();
      postList.innerHTML = posts.length ? posts.map((post) => `
        <article class="post">
          <span class="meta">${escapeHtml(post.category || 'Update')} · ${escapeHtml(post.date || 'Latest')} · ${post.published ? 'Published' : 'Draft'}</span>
          <h3>${escapeHtml(post.title)}</h3>
          ${post.image_url ? `<img src="${escapeHtml(post.image_url)}" alt="${escapeHtml(post.title)}" style="width:100%;height:160px;object-fit:cover;border-radius:12px;margin:4px 0 10px">` : ''}
          <p>${escapeHtml(post.caption)}</p>
          <div class="post-actions"><button class="secondary" data-edit="${post.id}" type="button">Edit</button><button class="danger" data-delete="${post.id}" type="button">Delete</button></div>
        </article>
      `).join('') : '<article class="post"><h3>No posts yet</h3><p>Publish your first update from this private workspace.</p></article>';
    } catch (error) {
      message(formMessage, explainError(error));
    }
  };

  const resetForm = () => {
    postForm.reset();
    editingId = null;
    formHeading.textContent = 'Publish an update';
    publishedInput.checked = true;
    savePostButton.textContent = 'Publish update';
    message(formMessage, '');
  };

  const uploadImage = async (file, userId) => {
    if (!file) return null;
    const safeName = file.name.replace(/[^a-z0-9._-]/gi, '-');
    const path = `${userId}/${Date.now()}-${safeName}`;
    const { error } = await supabase.storage.from(config.storageBucket).upload(path, file, { upsert: false });
    if (error) throw error;
    return supabase.storage.from(config.storageBucket).getPublicUrl(path).data.publicUrl;
  };

  const startApp = async (session) => {
    if (!session) {
      hide(app);
      show(loginPanel);
      return;
    }
    hide(loginPanel);
    show(app);
    show(mediaManager);
    await renderPosts();
    await renderMedia();
  };

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    message(loginMessage, '');
    const { error } = await supabase.auth.signInWithPassword({
      email: document.querySelector('#email').value.trim(),
      password: document.querySelector('#password').value
    });
    if (error) message(loginMessage, error.message);
  });

  postForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    message(formMessage, '');
    message(statusMessage, 'Saving...');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const imageFile = document.querySelector('#image').files[0];
      const imageUrl = await uploadImage(imageFile, user.id);
      const payload = {
        title: document.querySelector('#title').value.trim(),
        category: document.querySelector('#category').value,
        date: document.querySelector('#date').value,
        caption: document.querySelector('#caption').value.trim(),
        published: publishedInput.checked
      };
      if (imageUrl) payload.image_url = imageUrl;
      const request = editingId
        ? supabase.from('posts').update(payload).eq('id', editingId)
        : supabase.from('posts').insert(payload);
      const { error } = await request;
      if (error) throw error;
      resetForm();
      message(statusMessage, 'Saved.');
      await renderPosts();
    } catch (error) {
      message(statusMessage, '');
      message(formMessage, explainError(error));
    }
  });

  document.querySelector('#clear-form').addEventListener('click', resetForm);
  document.querySelector('#sign-out').addEventListener('click', () => supabase.auth.signOut());
  publishedInput.addEventListener('change', () => {
    savePostButton.textContent = publishedInput.checked ? 'Publish update' : 'Save draft';
  });

  mediaForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    message(mediaMessage, 'Saving...');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const file = document.querySelector('#media-file').files[0];
      const mediaType = file ? (file.type.startsWith('video/') ? 'video' : 'image') : 'image';
      const mediaUrl = file ? await uploadImage(file, user.id) : null;
      const payload = {
        number: Number(document.querySelector('#media-number').value),
        group_id: document.querySelector('#media-group').value.trim().toLowerCase(),
        media_type: mediaType,
        title: document.querySelector('#media-title').value.trim(),
        caption: document.querySelector('#media-caption').value.trim(),
        visible: document.querySelector('#media-visible').checked,
        sort_order: Number(document.querySelector('#media-number').value)
      };
      if (mediaUrl) payload.media_url = mediaUrl;
      const request = editingMediaId
        ? supabase.from('media_assets').update(payload).eq('id', editingMediaId)
        : supabase.from('media_assets').insert(payload);
      const { error } = await request;
      if (error) throw error;
      resetMediaForm();
      message(mediaMessage, 'Media saved.');
      await renderMedia();
    } catch (error) {
      message(mediaMessage, explainError(error));
    }
  });

  document.querySelector('#clear-media').addEventListener('click', resetMediaForm);

  mediaList.addEventListener('click', async (event) => {
    const editId = event.target.dataset.mediaEdit;
    const hideId = event.target.dataset.mediaHide;
    if (editId) {
      const media = await getMedia();
      const item = media.find((entry) => entry.id === editId);
      if (!item) return;
      editingMediaId = item.id;
      document.querySelector('#media-id').value = item.id;
      document.querySelector('#media-title').value = item.title || '';
      document.querySelector('#media-group').value = item.group_id || '';
      document.querySelector('#media-number').value = item.number || '';
      document.querySelector('#media-caption').value = item.caption || '';
      document.querySelector('#media-visible').checked = item.visible !== false;
      window.scrollTo({ top: document.querySelector('#media-manager').offsetTop, behavior: 'smooth' });
    }
    if (hideId) {
      const media = await getMedia();
      const item = media.find((entry) => entry.id === hideId);
      if (!item) return;
      const { error } = await supabase.from('media_assets').update({ visible: !item.visible }).eq('id', hideId);
      if (error) message(mediaMessage, explainError(error));
      await renderMedia();
    }
  });

  postList.addEventListener('click', async (event) => {
    const editId = event.target.dataset.edit;
    const deleteId = event.target.dataset.delete;
    if (editId) {
      const posts = await getPosts();
      const post = posts.find((item) => item.id === editId);
      if (!post) return;
      editingId = post.id;
      document.querySelector('#title').value = post.title || '';
      document.querySelector('#category').value = post.category || 'Update';
      document.querySelector('#date').value = post.date || '';
      document.querySelector('#caption').value = post.caption || '';
      publishedInput.checked = post.published !== false;
      formHeading.textContent = 'Edit update';
      savePostButton.textContent = publishedInput.checked ? 'Update published post' : 'Save draft';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    if (deleteId && window.confirm('Delete this update?')) {
      const { error } = await supabase.from('posts').delete().eq('id', deleteId);
      if (error) message(formMessage, error.message);
      await renderPosts();
    }
  });

  supabase.auth.getSession().then(({ data: { session } }) => startApp(session));
  supabase.auth.onAuthStateChange((_event, session) => startApp(session));
})();
