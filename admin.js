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
  let editingId = null;
  let supabase;

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
    await renderPosts();
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
