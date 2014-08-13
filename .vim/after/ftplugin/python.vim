nnoremap <buffer> <Leader>b :call fxns#InsertDebugLine("import pudb; pudb.set_trace()  # XXX BREAKPOINT", line('.'))<CR>
nnoremap <buffer> <Leader>8 :SyntasticCheck flake8<CR>
