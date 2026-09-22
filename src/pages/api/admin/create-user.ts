export const prerender = false;

import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabase-admin';

export const POST: APIRoute = async ({ request, redirect, locals }) => {
	// Belt-and-suspenders: this route also runs behind the /api/admin
	// middleware guard, but it uses the service role key, so we check again.
	if (!locals.user) {
		return redirect('/login');
	}

	const formData = await request.formData();
	const email = formData.get('email')?.toString();
	const password = formData.get('password')?.toString();

	if (!email || !password) {
		return redirect('/admin/users/new?error=missing_fields');
	}

	const { error } = await supabaseAdmin.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
	});

	if (error) {
		return redirect(`/admin/users/new?error=${encodeURIComponent(error.message)}`);
	}

	return redirect('/admin/users?created=1');
};
