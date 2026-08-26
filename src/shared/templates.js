export const TEMPLATE_PACKS = [
  {
    vertical: 'E-commerce',
    icon: '🛒',
    templates: [
      {
        name: 'Busca de produto',
        prompt: '1. Acesse {{baseUrl}}\n2. Use o campo de busca do site para procurar por "{{produto}}"\n3. Verifique que a página de resultados exibe pelo menos 1 produto relacionado\n4. Verifique que cada resultado mostra nome e preço',
      },
      {
        name: 'Adicionar ao carrinho',
        prompt: '1. Acesse {{baseUrl}}\n2. Busque por "{{produto}}" e abra o primeiro resultado\n3. Adicione o produto ao carrinho\n4. Verifique que o contador/ícone do carrinho foi atualizado\n5. Abra o carrinho e verifique que o produto está listado com o preço correto',
      },
      {
        name: 'Checkout até o pagamento (sem concluir)',
        prompt: '1. Acesse {{baseUrl}} e adicione um produto qualquer ao carrinho\n2. Inicie o checkout\n3. Avance até a etapa de pagamento SEM CONCLUIR a compra\n4. Verifique que o resumo do pedido mostra o produto, o subtotal e o frete\n5. NÃO clique em finalizar/pagar — encerre o teste na tela de pagamento',
      },
      {
        name: 'Cupom de desconto inválido',
        prompt: '1. Acesse {{baseUrl}} e adicione um produto ao carrinho\n2. No carrinho, aplique o cupom "CUPOMINVALIDO123"\n3. Verifique que o sistema exibe uma mensagem de erro clara\n4. Verifique que o total NÃO foi alterado',
      },
    ],
  },
  {
    vertical: 'SaaS / Login',
    icon: '🔐',
    templates: [
      {
        name: 'Login com credenciais válidas',
        prompt: '1. Acesse {{baseUrl}}/login\n2. Preencha o e-mail com {{usuario}}\n3. Preencha a senha com {{senha}}\n4. Clique em Entrar\n5. Verifique que a URL muda para a área logada (dashboard/home)\n6. Verifique que o nome do usuário aparece na interface',
      },
      {
        name: 'Login com senha inválida',
        prompt: '1. Acesse {{baseUrl}}/login\n2. Preencha o e-mail com {{usuario}}\n3. Preencha a senha com "senha-errada-123"\n4. Clique em Entrar\n5. Verifique que uma mensagem de erro é exibida\n6. Verifique que a URL NÃO mudou para a área logada',
      },
      {
        name: 'Recuperação de senha',
        prompt: '1. Acesse {{baseUrl}}/login\n2. Clique em "Esqueci minha senha" (ou equivalente)\n3. Preencha o e-mail com {{usuario}}\n4. Envie o formulário\n5. Verifique que aparece a confirmação de envio do e-mail de recuperação',
      },
      {
        name: 'Logout',
        prompt: '1. Acesse {{baseUrl}} já logado (ou faça login com {{usuario}} e {{senha}})\n2. Faça logout pelo menu do usuário — este teste autoriza explicitamente clicar em Sair/Logout\n3. Verifique que a sessão foi encerrada (volta ao login ou à home pública)\n4. Tente acessar uma URL da área logada e verifique que exige login novamente',
      },
    ],
  },
  {
    vertical: 'Institucional / Formulários',
    icon: '📋',
    templates: [
      {
        name: 'Formulário de contato — validações',
        prompt: '1. Acesse {{baseUrl}} e navegue até a página de contato\n2. Envie o formulário VAZIO e verifique que aparecem mensagens de campo obrigatório\n3. Preencha o e-mail com "email-invalido" e verifique a mensagem de formato inválido\n4. Preencha todos os campos corretamente (use dados de teste) e envie\n5. Verifique a mensagem de sucesso',
      },
      {
        name: 'Navegação do menu principal',
        prompt: '1. Acesse {{baseUrl}}\n2. Colete os links do menu principal\n3. Para cada item principal do menu (máximo 5): navegue, verifique que a página carrega com título coerente e sem erros\n4. Ao final, use get_errors para verificar se houve erros de console ou de rede durante a navegação',
      },
      {
        name: 'Saúde técnica da home',
        prompt: '1. Acesse {{baseUrl}}\n2. Verifique que a página tem um título e um H1 coerentes\n3. Verifique que o conteúdo principal carregou (texto visível relevante)\n4. Use get_errors e verifique que não há erros de console nem falhas de rede\n5. Reporte qualquer erro encontrado como bug',
      },
      {
        name: 'Busca do site',
        prompt: '1. Acesse {{baseUrl}}\n2. Use a busca do site com o termo "{{termo}}"\n3. Verifique que os resultados são relacionados ao termo\n4. Busque por "xyzabc123semresultado" e verifique que o site exibe um estado vazio adequado (mensagem de "nenhum resultado")',
      },
    ],
  },
];
